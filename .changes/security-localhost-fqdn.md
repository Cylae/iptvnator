---
type: fix
area: security
---

Remote URL validation rejects absolute DNS names in the localhost namespace, including trailing-dot forms. Redirect handling also prevents Stalker serial-number and stale Host headers from being forwarded to another host, and reports malformed redirect locations as controlled policy errors.
