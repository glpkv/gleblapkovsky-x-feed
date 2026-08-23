import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const handle = "gleblapkovsky";
const profileUrl = `https://x.com/${handle}`;
const maxSavedPosts = 50;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.resolve(scriptDirectory, "../x-posts.json");

function createdAtFromId(id) {
  const twitterEpoch = 1288834974657n;
  const timestamp = (BigInt(id) >> 22n) + twitterEpoch;
  return new Date(Number(timestamp)).toISOString();
}

function cleanFallbackText(rawText) {
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const handleIndex = lines.findIndex((line) => line === `@${handle}`);

  if (handleIndex < 0) {
    return "";
  }

  const content = lines.slice(handleIndex + 2);
  const metadataStart = content.findIndex((line) =>
    /^(Made with AI|Сделано с помощью ИИ)$/i.test(line),
  );
  const withoutMetadata =
    metadataStart >= 0 ? content.slice(0, metadataStart) : content;

  while (
    withoutMetadata.length > 0 &&
    /^[\d.,]+[KMB]?$/.test(withoutMetadata.at(-1) ?? "")
  ) {
    withoutMetadata.pop();
  }

  return withoutMetadata
    .join("\n")
    .replace(/\s*(Show more|Показать ещё)\s*$/i, "")
    .trim();
}

const existingPosts = JSON.parse(await readFile(dataFile, "utf8"));
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  await page.goto(profileUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.locator("article").first().waitFor({ timeout: 45_000 });

  const showMoreButtons = page.getByRole("button", {
    name: /^(Show more|Показать ещё)$/,
  });

  for (let index = 0; index < (await showMoreButtons.count()); index += 1) {
    await showMoreButtons.nth(index).click().catch(() => undefined);
  }

  const scrapedPosts = await page.locator("article").evaluateAll(
    (articles, profileHandle) =>
      articles
        .map((article) => {
          const statusLink = Array.from(
            article.querySelectorAll('a[href*="/status/"]'),
          ).find((link) =>
            new RegExp(`/${profileHandle}/status/\\d+`).test(
              link.getAttribute("href") ?? "",
            ),
          );

          if (!statusLink) {
            return null;
          }

          const match = statusLink
            .getAttribute("href")
            ?.match(new RegExp(`/${profileHandle}/status/(\\d+)`));
          const id = match?.[1];

          if (!id) {
            return null;
          }

          const textNode = article.querySelector('[data-testid="tweetText"]');
          const media = Array.from(
            article.querySelectorAll('img[src*="pbs.twimg.com/media"]'),
          )
            .map((image) => image.getAttribute("src"))
            .filter(Boolean);

          return {
            id,
            text: textNode?.innerText?.trim() ?? "",
            fallbackText: article.innerText,
            media,
          };
        })
        .filter(Boolean),
    handle,
  );

  const freshPosts = scrapedPosts
    .map((post) => {
      const text = post.text || cleanFallbackText(post.fallbackText);

      if (!text) {
        return null;
      }

      return {
        id: post.id,
        text,
        createdAt: createdAtFromId(post.id),
        url: `${profileUrl}/status/${post.id}`,
        media: post.media.map((url) =>
          url.replace(/([?&])name=[^&]+/, "$1name=large"),
        ),
      };
    })
    .filter(Boolean);

  if (freshPosts.length === 0) {
    throw new Error("X returned no readable posts; the saved feed was not changed.");
  }

  const merged = new Map(
    [...freshPosts, ...existingPosts].map((post) => [post.id, post]),
  );
  const nextPosts = [...merged.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, maxSavedPosts);

  await writeFile(dataFile, `${JSON.stringify(nextPosts, null, 2)}\n`);
  console.log(`Saved ${freshPosts.length} current X posts (${nextPosts.length} total).`);
} finally {
  await browser.close();
}
