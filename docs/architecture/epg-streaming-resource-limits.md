# EPG Streaming Resource Limits

IPTVnator decodes XMLTV streams incrementally and writes channels and programmes to SQLite in batches. A bounded private spool plus preflight validation and one outer SQLite transaction prevent incomplete feeds from replacing the last successful source. Streaming still needs explicit limits because a compressed response can expand without bound or one XML element can contain an enormous text value.

## Limits

- Each EPG source is limited to **256 MiB of decoded bytes**. The counter runs after HTTP content-encoding and the optional file-level gzip layer, so gzip, Brotli, and deflate expansion all count toward the same ceiling.
- Each XMLTV text field is limited to **1 MiB of UTF-8 bytes**. This guards the parser's per-element text accumulator independently of the total-feed limit.
- The decoded-byte limit applies to both remote URLs and user-authorized local files. Local file authorization and remote URL / redirect validation remain separate controls; passing one does not bypass the other.

A limit violation fails the EPG import with an explicit `ERR_EPG_RESPONSE_TOO_LARGE` or XMLTV text-field error. The worker remains isolated from the renderer, and the stream pipeline tears down upstream sources when downstream decoding or validation fails.

## Validation and atomic refresh

The decoded stream is SAX-validated while it is spooled to a uniquely created temporary directory (directory permissions `0700`, file mode `0600`). The same 256 MiB decoded-input cap and 1 MiB text-field cap apply during this validation pass. No active EPG rows are changed until the complete document has parsed successfully and contains at least one channel.

The validated spool is then replayed in fixed 64 KiB reads through a UTF-8 `StringDecoder` while the source update runs inside one outer SQLite transaction. Existing channel/programme batch writes become nested savepoints, so a later import or storage failure rolls back earlier batches rather than leaving a partial refresh. Ordinary SQLite constraint failures affecting an individual programme row remain skippable; other storage failures propagate and abort the transaction. No database write transaction is held open during network I/O.

Replay progress uses a separate `EPG_COMMIT_PROGRESS` worker message at batch boundaries. The fetch coordinator resets its no-progress timeout on that message without publishing lower channel/programme counters during the second pass. The temporary directory is removed in a `finally` path on success and failure. At the start of the next import, a best-effort sweep removes only direct child directories with the private `iptvnator-epg-import-` prefix whose directory and spool-file timestamps are both older than 24 hours. Symlink directories and spool files are skipped, and cleanup failures do not block a new import.

This costs one extra SAX pass, sequential temporary-disk I/O, and up to 256 MiB of temporary storage in addition to the database space. A forcibly terminated worker may leave a spool until a later import runs the stale-spool sweep or an operator removes it manually.

## Rationale

The desktop parser must continue to support larger guides than the self-hosted web backend, so the decoded ceiling is higher than the web backend's 64 MiB XMLTV limit. The limit still bounds decompressed input and pathological text-field retention. It does not replace the worker's no-progress timeout, SQLite batching, URL safety policy, or local-file authorization.

## Regression coverage

- `epg-stream-decoder.spec.ts` covers exact decoded-byte boundary acceptance, gzip expansion beyond the limit, and source/output teardown after failures.
- `epg-streaming-parser.spec.ts` covers a UTF-8 field whose character count is below the limit but encoded byte count exceeds it.
- `epg-source-stream.spec.ts` retains local plain/gzip and remote source behavior checks.

Run these targets in a supported repository toolchain:

```bash
pnpm nx test electron-backend
pnpm run typecheck:backend
pnpm nx lint electron-backend
```

The changes must not be considered validated until those commands execute in the repository runtime and pass.
