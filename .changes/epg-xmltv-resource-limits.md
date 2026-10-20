---
type: fix
area: epg
---

XMLTV imports now enforce decoded-feed and per-field text limits, preventing oversized or highly compressed guides from consuming unbounded memory. The EPG worker reports a clear import error when a limit is exceeded.
