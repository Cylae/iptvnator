---
type: fix
area: security
---

Remote provider responses now have bounded download sizes, with stricter limits for M3U and XMLTV imports and a separate cap on gzip expansion. Oversized feeds fail explicitly instead of consuming unbounded memory. Compressed XMLTV feeds are recognized even when the `.gz` suffix uses uppercase letters.
