# EPG Streaming Resource Limits

IPTVnator decodes XMLTV streams incrementally and writes channels and programmes to SQLite in batches. Streaming avoids buffering an entire guide, but it does not by itself protect against a compressed response that expands without bound or a single XML element containing an enormous text value.

## Limits

- Each EPG source is limited to **256 MiB of decoded bytes**. The counter runs after HTTP content-encoding and the optional file-level gzip layer, so gzip, Brotli, and deflate expansion all count toward the same ceiling.
- Each XMLTV text field is limited to **1 MiB of UTF-8 bytes**. This guards the parser's per-element text accumulator independently of the total-feed limit.
- The decoded-byte limit applies to both remote URLs and user-authorized local files. Local file authorization and remote URL / redirect validation remain separate controls; passing one does not bypass the other.

A limit violation fails the EPG import with an explicit `ERR_EPG_RESPONSE_TOO_LARGE` or XMLTV text-field error. The worker remains isolated from the renderer, and the stream pipeline tears down upstream sources when downstream decoding or validation fails.

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
