---
type: fix
area: epg
---

XMLTV imports now enforce decoded-feed and per-field text limits. The complete feed is validated into a bounded, private temporary spool before active source rows are changed; the validated spool is replayed inside one SQLite transaction, so malformed, empty, oversized, or storage-failed imports preserve the previous guide. The EPG worker reports a clear error when a feed is rejected.
