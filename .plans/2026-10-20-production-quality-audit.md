# Production Quality Audit and Remediation Plan

**Date:** 2026-10-20  
**Base branch:** `master`  
**Base commit:** `3634e8a59dee88cbbce83cbe99ffce0d18b1f4d0`  
**Status:** Initial repository inventory complete; behavioral audit and remediation pending.

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
- **Validation status:** Regression tests are authored but not yet executed. The environment cannot resolve `github.com` for a local clone, and the draft PR currently has no visible Actions runs or commit status checks. Do not treat the fix as verified until executable checks return results.
- **Review vehicle:** Draft PR #1, `https://github.com/Cylae/iptvnator/pull/1`, remains open so the change is isolated from `master` while the audit continues.

### Next steps

1. Obtain a working execution path for the repository tests and CI.
2. Verify this fix against the real lockfile and run its focused test suite.
3. Continue the audit in security, data integrity, source compatibility, playback, UI, performance, and packaging domains; log each evidenced defect and its regression proof.


- **Additional verification:** The corrected version-extraction logic was exercised against all 3,479 package keys parsed from the repository's actual `pnpm-lock.yaml`, including 42 `nx`/`@nx/*` entries and 11 peer-qualified entries; the scan found zero mismatches. Isolated Node.js probes also covered plain keys, peer-qualified keys, prerelease versions, and a genuine mismatch. This is targeted logic validation, **not** a substitute for running the committed Node test suite or the full project checks.


### Follow-up verification — 2026-10-20

- Tightened the version parser to require a semantic version at the beginning of the resolved key; malformed strings such as `nx@garbage23.2.1` can no longer pass by containing a valid-looking version substring.
- Added regression coverage for malformed `nx` and `@nx/*` lockfile keys.
- Executed an isolated Node.js harness against the validator logic for four cases: matching peer-qualified keys, real mismatches, malformed embedded versions, and peer-qualified prereleases. All four passed. This harness does not replace the repository's `node --test` suite.
- Re-read the repository's CI workflow: it already includes `pnpm run deps:nx:validate`, typechecks, coverage checks, i18n drift, lint and release-note validation. However, GitHub currently reports no Actions runs for the branch/PR, so there is no remote CI result to rely on. The local clone remains blocked by DNS/network resolution, and the full suite has not run.
- Reviewed the Electron renderer-navigation allowlist and credential-header scoping implementation. The inspected code explicitly limits external-browser launching to HTTP(S), packaged renderer navigation to the expected index file, and portal credentials to the exact configured origin; no new production defect was established from this read-only pass.
