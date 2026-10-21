# Production Quality Audit and Remediation Plan

**Date:** 2026-10-20  
**Base branch:** `master`  
**Base commit:** `3634e8a59dee88cbbce83cbe99ffce0d18b1f4d0`  
**Status:** Consolidated draft PR #7 contains the response-size protections originally in PR #4, decoded XMLTV limits from PR #6, and bounded PWA provider-target state from PR #7. PR #4 and PR #6 are closed as superseded; their heads remain reachable from the integration commit. Database initialization recovery from PR #5 is merged into `master` at `5d4dbceee84368bf351774abbdbe60c5ae3b217e`. Full repository validation remains unavailable: local checkout cannot resolve `github.com`, and GitHub currently reports no Actions runs or commit checks. No final-head test/build success is claimed.

## Initial inventory

- Application: Angular 22 / Electron 43, organized as an Nx workspace, with browser/PWA and website projects.
- Repository tree: 4,189 entries at the audited commit; 1,036 test/spec files and 1,611 production TypeScript files by filename-based inventory. These are inventory counts, not coverage measurements.
- Existing verification entry points include unit tests, type checks, lint, tiered coverage, E2E, package-layout verification, i18n drift checks, agent/skill validation, and release-note validation.
- Repository-specific contracts are documented in `AGENTS.md`, `docs/architecture/validation-map.md`, and `docs/maintenance/agent-context-map.md`.
- The repository API returned zero GitHub Actions workflow runs during this inspection. This does not prove that CI is disabled or that checks pass; a baseline must be obtained from a runnable checkout or a newly triggered workflow.
- A local clone was attempted but could not resolve `github.com` in the current execution environment. Consequently, no local tests or builds have been claimed as executed.

## Working rules

1. Keep the current default branch unchanged during investigation. Use this audit branch for changes and validate before proposing a merge.
2. Follow the repository's canonical domain contracts before editing production code.
3. Establish a reproducible baseline before interpreting a test failure as a regression.
4. For each behavioral fix, add a regression test that fails for the original defect and passes for the fix.
5. Do not weaken tests, coverage ratchets, lint rules, security controls, or CI gates to make a change pass.
6. Preserve persisted data and existing external behavior unless a defect is demonstrated.
7. Add a `.changes/` release note for user-visible behavior changes; exempt documentation-only and test-only work according to repository policy.
8. Re-run affected checks after each change, then run the broadest feasible validation before delivery.
9. Report unavailable checks explicitly; never represent an unexecuted test, security scan, or build as passing.

## Prioritized investigation

### P0 — Establish trustworthy verification

- Obtain the baseline results for the repository's CI workflow.
- Confirm Node and pnpm versions from `.nvmrc` and `package.json`.
- Verify lockfile consistency and Nx project/target discovery.
- Run dependency-policy, stylesheet-input, i18n, agent-guidance, skill, typecheck, lint, unit/coverage, and packaging checks using the documented commands.

### P1 — Security and data integrity

- Review Electron process isolation, preload bridge exposure, IPC validation, navigation and external URL handling against `docs/architecture/electron-security.md`.
- Review playlist/XMLTV parsing, URL redirects, host validation, proxy boundaries, timeouts, and resource limits.
- Review SQLite startup, migration ordering, cancellation, transaction boundaries, backup/restore, and compatibility with historical schemas.
- Check credential handling and diagnostic redaction across Xtream and Stalker portal flows.

### P1 — Critical user journeys

- Exercise playlist import, refresh, switching, malformed and oversized inputs, and source failure recovery.
- Exercise portal authentication, category/catalog loading, EPG mapping, playback URL resolution, and provider timeouts.
- Exercise player engine fallback and packaged application startup across supported platforms.
- Use existing E2E fixtures and mocks where they preserve meaningful boundary behavior; use real SQLite/native integrations where mocks would hide defects.

### P2 — Maintainability and performance

- Use coverage reports and test inventory to identify untested runtime-owning code rather than optimizing raw coverage percentages.
- Investigate duplicate logic, stale compatibility shims, oversized production files, unsafe casts, swallowed errors, and unbounded work only where evidence supports a fix.
- Profile identified bottlenecks before changing data structures or concurrency behavior.
- Update the owning architecture document and add concise comments only where the rationale is not obvious from code.

## Completion gate

Do not declare completion until the final commit has been checked against the intended base, all relevant automated checks have results, regression coverage exists for each behavioral fix, and remaining platform/tooling limitations are documented. A green test suite is necessary but not sufficient: review the final diff for unintended behavior, data loss, security regressions, and weakened verification.


## Execution log

### 2026-10-20 — First verified tooling defect

- **Defect:** `tools/dependencies/check-nx-version-sync.mjs` compared complete pnpm lockfile package keys to the expected Nx version. pnpm v9 keys can include peer-context suffixes, for example `@nx/angular@23.2.1(e86c4a4fb085aa7a209327ce2b2f688a)` and `nx@23.2.1(@swc/core@1.16.1)`. The validator interpreted the suffix as part of the version and reported a false mismatch.
- **Evidence:** The current `pnpm-lock.yaml` contains both plain and peer-qualified entries for the same Nx packages.
- **Change:** Extract the semantic version prefix from lockfile keys while still rejecting real version mismatches; add regression tests for matching peer-qualified entries and a mismatched peer-qualified official package.
- **Files changed:** `tools/dependencies/check-nx-version-sync.mjs` and `tools/dependencies/check-nx-version-sync.test.mjs`.
- **Validation status at the time:** Regression tests were authored but the repository suite had not executed. The local clone could not resolve `github.com`; GitHub reported no Actions runs or commit checks. The isolated Node harness results above are not substitutes for the committed suite.
- **Review vehicle:** PR #1 was merged to `master` as `0d6152abb2df73742a58ab5b573075bfe5a8cbe8`.

### Current continuation plan

1. Obtain real validation for the final integration head: Electron backend tests and typecheck/lint; web-backend tests; web unit tests and typecheck/lint; affected coverage/validation gates; relevant PWA and EPG integration journeys. Standalone probes are supplemental only.
2. Validate the new atomic EPG spool/replay implementation against real SQLite integration tests and supported Windows/macOS/Linux runtimes. Confirm temporary-disk capacity and startup cleanup behavior for worker termination before release.
3. Add a process-wide budget for concurrent buffered provider response bodies; provider-target URL/DNS admission is now capped at 16 active validations per process and the route regression has been authored, but remains unexecuted.
4. Validate using the repository's declared Node/pnpm versions. The available runtime is below the declared Node minimum, and local clone DNS is blocked; no check may be described as passing unless it executes against the final head.
5. Continue the audit across local-file authorization, Xtream backup/restore, playback lifecycle, embedded MPV, portal credential boundaries, packaging, and compatibility. Treat local edits mentioned only in previous transcripts as unimplemented until a patch or working tree is recovered and verified.


- **Additional verification:** The corrected version-extraction logic was exercised against all 3,479 package keys parsed from the repository's actual `pnpm-lock.yaml`, including 42 `nx`/`@nx/*` entries and 11 peer-qualified entries; the scan found zero mismatches. Isolated Node.js probes also covered plain keys, peer-qualified keys, prerelease versions, and a genuine mismatch. This is targeted logic validation, **not** a substitute for running the committed Node test suite or the full project checks.


### Follow-up verification — 2026-10-20

- Tightened the version parser to require a semantic version at the beginning of the resolved key; malformed strings such as `nx@garbage23.2.1` can no longer pass by containing a valid-looking version substring.
- Added regression coverage for malformed `nx` and `@nx/*` lockfile keys.
- Executed an isolated Node.js harness against the validator logic for four cases: matching peer-qualified keys, real mismatches, malformed embedded versions, and peer-qualified prereleases. All four passed. This harness does not replace the repository's `node --test` suite.
- Re-read the repository's CI workflow: it already includes `pnpm run deps:nx:validate`, typechecks, coverage checks, i18n drift, lint and release-note validation. However, GitHub currently reports no Actions runs for the branch/PR, so there is no remote CI result to rely on. The local clone remains blocked by DNS/network resolution, and the full suite has not run.
- Reviewed the Electron renderer-navigation allowlist and credential-header scoping implementation. The inspected code explicitly limits external-browser launching to HTTP(S), packaged renderer navigation to the expected index file, and portal credentials to the exact configured origin; no new production defect was established from this read-only pass.


### Security pass — SSRF address classification

- **Defect:** Electron's `url-safety.ts` used a handwritten IP classifier that was less complete than the web backend's `provider-url-policy.ts`. It missed IPv4-compatible IPv6 loopback forms, multicast/non-global IPv6, and several reserved/documentation IPv6 blocks. Its IPv4 logic also blocked the entire `192.0.0.0/16` (rejecting addresses such as `192.0.1.1`) while missing `192.88.99.0/24`, causing desktop/web policy drift.
- **Change:** Align Electron with the web backend's `node:net` `BlockList` ranges for IPv4 and IPv6. IPv4-mapped IPv6 addresses continue to inherit the underlying IPv4 classification; other IPv6 addresses are accepted only from global-unicast space and outside the listed special-purpose ranges.
- **Regression coverage added:** IPv4 special-purpose range `192.88.99.0/24`, valid public `192.0.1.1`, IPv4-compatible `::7f00:1`, multicast `ff02::1`, IPv6 documentation `2001:db8::/32` and `3fff::/20`, 6to4 `2002::/16`, and known public IPv6 literals.
- **Targeted verification:** A local Node.js harness exercising the same `BlockList` policy passed 28 focused cases (9 blocked IPv4, 4 allowed IPv4, 12 blocked IPv6, 3 allowed public/mapped IPv6). The committed Jest suite and full CI still have not run; do not treat the harness as a substitute.


- **Release-note policy:** Added `.changes/security-ip-address-policy.md` for the runtime URL-safety change, matching the repository's release-note gate contract.
- **Diff-review correction:** A final patch review caught over-escaped regex literals in the Nx validator edit before merge. Corrected both patterns and ran a standalone Node syntax/behavior check against the exact regex forms; the four-case isolated validator harness was also re-run against the corrected logic. This reinforces why the committed test suite remains a required gate.

- **Implementation refinement:** Replaced the handwritten IPv6 word parser with `BlockList` handling for IPv4-mapped IPv6 as well, reducing bespoke address-parsing code and matching the web backend's approach more closely. Added a public IPv4-mapped IPv6 regression case to ensure the hardening does not block mapped public addresses.


### Follow-up security review — URL and redirect handling

- **PR:** [#2 — harden URL validation and redirect credentials](https://github.com/Cylae/iptvnator/pull/2).
- **Changes:** Strip the DNS root dot before applying the localhost namespace denylist, remove Stalker `SN` and explicit `Host` headers on unsafe redirects, and convert malformed redirect destinations into a controlled policy error.
- **Regression coverage:** Absolute localhost aliases, cross-host sensitive-header removal, and malformed redirect locations; the branch also tightens fail-closed handling for malformed IPv6 classification inputs.
- **Validation:** The prior local review recorded 141 focused Jest tests passing on the pinned PR head `cbe072c`. ESLint did not complete because the partial dependency installation failed during Windows module linking and Nx project discovery stalled. Full CI, typecheck, coverage, and E2E remain unverified; GitHub reports no Actions runs or check-runs for the merged head `43c317b`.

### Integrated remote-response resource limits — original PR #4, consolidated in PR #7

- **Branch/head:** `security/bound-remote-response-memory-2026-10-20` / `75706f54100a52e10358dd3585c93e07aff81dc2`.
- **Changes:** Limit remote M3U responses to 64 MiB; cap generic web-backend provider bodies at 128 MiB; cap plain XMLTV at 64 MiB, compressed XMLTV at 32 MiB, and gzip-expanded XMLTV at 64 MiB; apply the same M3U policy to Electron import and refresh.
- **Regression coverage:** Exact byte limits, oversized streaming bodies, UTF-8 counting/BOM behavior, gzip expansion, redirect-hop configuration, and failed-2xx body handling.
- **Validation:** The PR reports standalone probes only. The committed Jest suites, typecheck, lint, coverage, integration/E2E, and CI have not been executed for this head.
- **Compatibility gate:** Verify representative large Xtream/Stalker catalog responses before merge; the 128 MiB generic cap may reject unusually large responses.
- **Aggregate-memory risk to validate:** Per-response limits do not bound total memory across concurrent requests. The web transport buffers stream chunks, concatenates them, and creates a text/JSON representation; the reviewed host guard is a circuit breaker, not a general concurrency limiter. Verify a process-wide in-flight/byte budget under concurrent large responses, or explicitly retain this residual risk before presenting the change as complete memory-exhaustion protection.

### Integrated decoded XMLTV resource limits — original PR #6, consolidated in PR #7

- **Branch/head:** `security/bound-epg-stream-memory-2026-10-20` / `ee27aef28bb4a99f6be674cd234b50d2fd5bf44f`.
- **Changes:** Cap each decoded EPG source at 256 MiB after content-encoding and optional file-gzip layers, including authorized local files; cap each XMLTV text accumulator at 1 MiB of UTF-8 bytes.
- **Regression coverage:** Exact decoded-size boundaries, gzip expansion rejection, stream teardown, and UTF-8 byte-aware text limits.
- **Validation:** The PR reports an isolated Node harness only. Committed Jest tests, typecheck, lint, Electron integration tests, and CI remain unverified.
- **Data-integrity remediation added:** `epg-source-spool.ts` validates the full decoded stream while writing a private bounded spool, then replays it under one outer SQLite transaction only after successful preflight. Empty or malformed input never starts a database transaction; non-constraint storage failures propagate so outer rollback can preserve the previous state. Regression tests cover malformed late XML, empty feeds, UTF-8 split across chunks, and rollback semantics. These tests are authored but not executed on the repository runtime.

### Follow-up database reliability review

- **PR:** [#5 — recover after initialization failures](https://github.com/Cylae/iptvnator/pull/5).
- **Defect:** A rejected module-scoped database initialization promise could remain cached after SQLite open or initialization failure, preventing later calls from recovering without restarting the application.
- **Changes:** Close and clear a partially initialized SQLite handle and reset the cached promise only when the failing attempt still owns the initialization state. This ownership check prevents an older rejection handler from clearing a newer retry.
- **Regression coverage:** The Electron/SQLite harness exercises an open failure caused by a directory at the database file path, failure to initialize from a corrupt file, and a successful retry with `integrity_check` and schema verification.
- **Validation:** The committed integration test has not run in this environment.

### Integrated PWA provider-target bounds — original PR #7

- **Current branch:** `fix/pwa-provider-target-memory-bound-2026-10-20`.
- **Defect:** The self-hosted backend retained every distinct validated provider URL in an unbounded `Map<string, URL>`; the browser also cached registrations without a capacity bound. Long-lived or exposed instances could accumulate credential-bearing URLs and registration promises indefinitely.
- **Changes:** Add an LRU backend registry capped at 1,024 URLs and a browser registration cache capped at 256 entries. The browser cache key includes both backend URL and provider URL. A missing-target response triggers one registration refresh and one retry, but unrelated/upstream 404s are not retried. The request flow uses the identity of the registration promise rather than the deterministic target ID to avoid invalidating a concurrent refresh.
- **Regression coverage:** Bounded LRU behavior, active-target recency, duplicate registration, URL object isolation, invalid capacity values, shared in-flight registration, browser cache eviction, per-backend cache separation, and recovery for playlist, Xtream, and Stalker requests.
- **Documentation and release note:** `docs/architecture/pwa-self-hosted.md` and `.changes/security-provider-target-registry.md`.
- **Validation:** These tests are authored but not executed. The working environment cannot clone the repository and the Actions API continues to return zero workflow runs/checks. Do not merge until the owning web-backend and web unit suites, typechecks, lint, and relevant E2E checks have run.
- **Admission control added:** The LRU still bounds retained URL entries, and `ProviderTargetValidationGate` now caps active `POST /provider-targets` URL/DNS validations at 16. Requests beyond capacity fail fast with HTTP 503 rather than entering an unbounded waiting queue. Unit and integration regressions are authored but have not run on the repository toolchain. **Remaining memory risk:** per-response caps still do not bound the sum of several large bodies being buffered concurrently; a shared in-flight byte budget remains to be designed and validated.


### Consolidation record — 2026-10-21

- **Integration base:** `master` at `5d4dbceee84368bf351774abbdbe60c5ae3b217e` (includes the merged SQLite initialization recovery PR #5).
- **Included sources:** remote response caps / buffered provider handling from PR #4 (`75706f5`), decoded XMLTV and per-field caps from PR #6 (`ee27aef`), and LRU provider targets / browser-cache recovery from PR #7 (`e1dd5da`). The original heads remain reachable as integration commit parents to preserve provenance; PRs #4 and #6 have been closed as superseded.
- **Manual merge points:** Combined PR #4's response-size handling with PR #7's bounded provider target registry in `apps/web-backend/src/app/web-backend-app.ts`; added PR #4's redirect size-limit regression to the current `master` `validated-axios.spec.ts` without discarding the URL/credential redirect tests already merged from PR #2.
- **Unresolved validation:** GitHub Actions/check-run APIs have returned no runs/statuses for the repository, and a clean local checkout is unavailable due DNS resolution failure. This is not a passing validation result. Aggregate response-memory across concurrent buffered bodies remains a residual risk; provider-target admission is now capped at 16 simultaneous validations per process.

- **Atomic EPG import update:** Added a private 256 MiB-bounded decoded-source spool, SAX preflight and UTF-8-safe replay in a single outer SQLite transaction. Added rollback/error-classification regression tests. Repository tests remain unexecuted.
