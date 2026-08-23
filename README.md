# Gleb Lapkovsky X feed

Public feed data used by [gleblapkovsky.com](https://gleblapkovsky.com).

The scheduled workflow reads public posts from X and updates `x-posts.json`.
The portfolio website uses this file as a live source and keeps its own bundled
copy as a fallback.

All network-dependent steps are allowed to fail without turning the workflow
red, so temporary X or npm outages do not generate failure notifications.
`schedule-heartbeat.txt` changes once a week to keep the scheduled workflow
active even when there are no new posts for a long time.
