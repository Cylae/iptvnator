---
type: fix
area: security
---

The self-hosted backend and PWA now bound provider URL registration caches and concurrent URL/DNS validation. The backend admits at most 16 validations per process and returns HTTP 503 when all slots are occupied. If a target is evicted or the backend restarts, the PWA automatically registers it again and retries once; upstream provider errors are not retried.
