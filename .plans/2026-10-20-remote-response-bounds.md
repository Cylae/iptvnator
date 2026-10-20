# Remote Provider Response Bounds

**Status:** Implementation prepared for review; full repository validation is pending.
**Scope:** Web-backend provider responses and Electron remote M3U imports/refreshes.
**Safety invariant:** Bound data before parsing or decompression can amplify its memory footprint. Never turn a body-processing failure into a successful upstream response.

## Findings

1. The web backend buffered streamed responses into a list of chunks, concatenated them, and parsed M3U/XMLTV without an explicit byte limit.
2. Compressed XMLTV was decompressed synchronously without a maximum output length, allowing a small compressed response to expand into a much larger in-memory buffer.
3. Electron remote M3U import and auto-refresh shared timeout behavior but had no explicit Axios `maxContentLength` limit.
4. A provider could send HTTP 200 headers and then deliver a truncated, stalled, or oversized body. The validated web transport did not mark that endpoint as having responded until after the body was read, and some error paths could preserve a 2xx status in the API response.

## Changes

- Add one shared 64 MiB remote M3U limit in `@iptvnator/shared/m3u-utils`, used by the web backend and Electron.
- Centralize Electron playlist request configuration so normal import and worker-based refresh share timeout, User-Agent, TLS trust, cancellation, and body-size policy.
- Cap ordinary web-backend response bodies at 128 MiB by default; enforce lower 64 MiB M3U and XMLTV limits and a 32 MiB compressed XMLTV limit.
- Apply a separate 64 MiB maximum to gzip-expanded XMLTV data using the Node zlib `maxOutputLength` option.
- Reject invalid zero-byte gzip output limits before calling zlib and recognize `.gz` suffixes case-insensitively.
- Preserve the provider response status as internal evidence once response headers arrive, but normalize a failed 2xx body into a gateway error instead of a false success.
- Add regression tests for exact limits, first-byte-limit overflow, UTF-8 byte counting, stream destruction, UTF-8 BOM stripping, gzip expansion, redirect-hop configuration, route-level caps, and 2xx body failures.
- Add a user-facing release note.

## Validation plan

Run the narrowest tests first, then the complete repository gates:

```bash
pnpm nx test web-backend
pnpm nx test electron-backend
pnpm nx test m3u-utils
pnpm run typecheck:ci
pnpm run lint
pnpm run coverage:ci
pnpm run release:notes:validate
```

Also inspect the CI runs for the exact PR head SHA and run affected E2E flows if app code changes are reported by Nx.

## Current validation status

- Regression tests are authored but **have not been executed in the repository checkout**.
- A standalone Node v22.16.0 harness passed 34 blocked-address examples, 7 public-address examples, localhost root-dot variants, gzip output-cap rejection, exact byte-limit acceptance, oversized-stream rejection, and UTF-8 BOM stripping. The harness mirrors the intended policy; it is supplemental and does not replace Jest, typecheck, lint, or integration tests.
- This execution environment could not resolve `github.com` for a local clone. GitHub currently reports no workflow runs or commit checks for prior commits, so no green CI evidence is available yet.
- Do not merge until the repository's actual test, typecheck, lint, and CI results have been reviewed.

## Risk and compatibility notes

- Remote M3U feeds above 64 MiB and XMLTV feeds above the configured limits will now fail closed. Such feeds should be reduced or split rather than allowed to consume unbounded memory.
- No database schemas, persisted records, authentication contracts, or playlist parsing semantics are intentionally changed.
- The 128 MiB generic cap applies to web-backend provider responses in addition to the narrower playlist/EPG limits; review representative large Xtream/Stalker catalog responses in CI or E2E before release.
