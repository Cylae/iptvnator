---
type: fix
area: security
---

Remote URL validation now applies a consistent set of reserved IPv4 and IPv6 ranges. This blocks additional non-routable IPv6 targets while avoiding unnecessary rejection of some valid public IPv4 addresses.