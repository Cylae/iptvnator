# Bounded Provider Target Registry

**Status:** Implementation prepared for review; project test execution remains blocked by the current environment.
**Scope:** In-memory registry of validated target URLs used by the self-hosted web backend.

## Finding

`createWebBackendApp` kept every distinct validated provider URL in a process-lifetime `Map`. Repeated registration of the same normalized URL reused its deterministic SHA-256 key, but an arbitrary sequence of unique URLs could grow the map without a bound. Request-body parsing already limits each registration payload to 16 KiB; the missing control was a total registry capacity.

## Change

- Replace the plain map with a bounded LRU registry whose default capacity is 1,024 URLs.
- Refresh recency on registry reads so frequently used targets survive normal source churn.
- Move a re-registered key to the newest position without growing the registry.
- Evict the least recently used entry when a new unique target arrives at capacity. Requests for an evicted ID receive the existing `404 Provider target not found` response and the frontend must register the source again.
- Add isolated tests for LRU eviction, reads that refresh recency, duplicate key replacement, and invalid capacities.
- Add an English architecture contract, maintenance context-map link, and release note.

## Validation

- Run `pnpm nx test web-backend`, `pnpm nx lint web-backend`, `pnpm run typecheck:backend`, and `pnpm run release:notes:validate` in the supported repository toolchain.
- Ran standalone `tsc --noEmit --strict --target ES2022 --lib ES2022,DOM` against the exact registry class; it passed.
- A compiled Node probe passed default-cap verification, LRU eviction, recency refresh, key replacement, invalid-capacity rejection (including fractional and infinite values), and adversarial insertion of 1,030 distinct targets without exceeding the 1,024-entry cap. This does not substitute for the web-backend Jest suite.
- GitHub currently reports no Actions runs or check runs for the repository. Do not merge until the actual repository checks have results for the PR head.

## Operational note

This is an in-memory resource bound, not authentication, URL validation, expiration, or persistence. All raw proxy URLs must continue to pass the existing URL policy before registration. When the cap is reached, eviction is intentionally fail-closed rather than allowing memory usage to grow indefinitely.
