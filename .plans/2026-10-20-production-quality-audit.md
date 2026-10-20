# Production Quality Audit and Remediation Plan

**Date:** 2026-10-20  
**Base branch:** `master`  
**Base commit:** `3634e8a59dee88cbbce83cbe99ffce0d18b1f4d0`  
**Status:** In progress — the initial Nx and Electron SSRF fixes are merged into `master` at `0d6152abb2df73742a58ab5b573075bfe5a8cbe8`. Follow-up URL/redirect hardening and SQLite initialization recovery are in separate open PRs. Bounded provider-target memory and PWA stale-target recovery are in progress. Full-suite validation remains blocked by the unavailable local network and absent GitHub Actions runs.

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

1. Restore a runnable checkout or an actual Actions execution path before claiming test, typecheck, lint, build, coverage, or packaging success.
2. Keep concrete security, data-integrity, and resource-bound fixes isolated and regression-tested.
3. Continue with high-risk network boundaries, database startup/migration paths, playlist parsing, portal authentication, playback, and packaging; log each evidenced defect and validation result.


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
- **Validation:** The tests are authored but were not executed. GitHub reports zero workflow runs and zero check runs for the PR head; the full Jest, lint, typecheck, and E2E gates remain unverified.

### Follow-up database reliability review

- **PR:** [#5 — recover after initialization failures](https://github.com/Cylae/iptvnator/pull/5).
- **Defect:** A rejected module-scoped database initialization promise could remain cached after SQLite open or initialization failure, preventing later calls from recovering without restarting the application.
- **Changes:** Close and clear a partially initialized SQLite handle and reset the cached promise only when the failing attempt still owns the initialization state. This ownership check prevents an older rejection handler from clearing a newer retry.
- **Regression coverage:** The Electron/SQLite harness exercises an open failure caused by a directory at the database file path, failure to initialize from a corrupt file, and a successful retry with `integrity_check` and schema verification.
- **Validation:** The committed integration test has not run in this environment.

### Follow-up PWA resource-bound review — provider targets

- **Current branch:** `fix/pwa-provider-target-memory-bound-2026-10-20`.
- **Defect:** The self-hosted backend retained every distinct validated provider URL in an unbounded `Map<string, URL>`; the browser also cached registrations without a capacity bound. Long-lived or exposed instances could accumulate credential-bearing URLs and registration promises indefinitely.
- **Changes:** Add an LRU backend registry capped at 1,024 URLs and a browser registration cache capped at 256 entries. The browser cache key includes both backend URL and provider URL. A missing-target response triggers one registration refresh and one retry, but unrelated/upstream 404s are not retried. The request flow uses the identity of the registration promise rather than the deterministic target ID to avoid invalidating a concurrent refresh.
- **Regression coverage:** Bounded LRU behavior, active-target recency, duplicate registration, URL object isolation, invalid capacity values, shared in-flight registration, browser cache eviction, per-backend cache separation, and recovery for playlist, Xtream, and Stalker requests.
- **Documentation and release note:** `docs/architecture/pwa-self-hosted.md` and `.changes/security-provider-target-registry.md`.
- **Validation:** These tests are authored but not executed. The working environment cannot clone the repository and the Actions API continues to return zero workflow runs/checks. Do not merge until the owning web-backend and web unit suites, typechecks, lint, and relevant E2E checks have run.
