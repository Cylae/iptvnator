---
type: fix
area: security
---

Remote playlist and provider responses now have finite size limits, and oversized or highly compressed feeds are rejected before they can consume unbounded memory. Normal-sized playlists and provider responses keep their existing import flow.
