# EPG Stream Resource Limits

**Status:** Implementation prepared for review; repository test execution is blocked in the current environment.
**Scope:** Electron XMLTV decoder, local and remote stream entry points, and SAX text accumulation.

## Findings

- Remote and local EPG streams passed through incremental decoders but had no aggregate decoded-byte limit. Compression layers could expand well beyond the downloaded size.
- `StreamingEpgParser` concatenated text events into `currentTextContent` without a per-element limit. A malicious or malformed field could therefore retain a very large string even though database inserts are batched.

## Changes

- Add a 256 MiB decoded-byte ceiling after all HTTP content-encoding and optional file-level gzip layers.
- Apply the same byte limiter to authorized local-file streams after signature-detected gzip decoding.
- Reject any individual XMLTV text field above 1 MiB of UTF-8 bytes.
- Test the exact byte boundary, gzip expansion beyond a small injected test cap, stream teardown, and a UTF-8 text value whose character count is below the limit but byte count exceeds it.
- Add English architecture documentation and a user-facing release note.

## Validation

- A focused standalone Node v22.16.0 harness passed: exact decoded-byte boundary, gzip expansion rejection at a 512-byte test cap, source/output teardown, and UTF-8 byte counting.
- **The committed Jest suites, typecheck, lint, coverage, and Electron integration tests have not run.** The current environment cannot resolve `github.com` to obtain a repository checkout, and the installed Node v22.16.0 is below the repository's declared minimum v22.22.3.
- GitHub currently reports no Actions runs or commit checks, including on other open PRs. Do not treat source inspection or the standalone harness as a passing repository suite.

## Compatibility and known limitation

XMLTV sources producing more than 256 MiB after decoding, or one text field above 1 MiB, will now fail closed. The EPG worker currently commits valid rows in batches as a stream is parsed, so a late stream failure can occur after earlier batches have been persisted. This is an existing incremental-import behavior, but it should be considered when evaluating rejected oversized feeds; fully atomic source replacement would require a separate staging-and-publish design rather than holding a SQLite write transaction open over a network stream.
