---
type: fix
area: security
---

The self-hosted backend now bounds its in-memory registry of validated provider URLs. Under heavy source churn, the least recently used target is evicted and can be registered again when needed.
