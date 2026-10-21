---
type: fix
area: security
---

Remote provider responses now have bounded download sizes, with stricter limits for M3U and XMLTV imports and a separate cap on gzip expansion. Oversized feeds fail explicitly instead of consuming unbounded memory. Streamed provider response bodies also share a 512 MiB buffer/decode reservation budget; when concurrent responses exhaust it, excess bodies are aborted with a retryable 503 rather than being fully buffered. This budget covers raw chunks, temporary concatenation, and conservative UTF-16 decoding, not complete process RSS or parsed JSON object graphs. Compressed XMLTV feeds are recognized even when the `.gz` suffix uses uppercase letters.
