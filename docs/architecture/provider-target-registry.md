# Provider Target Registry

The self-hosted web backend validates a submitted provider URL once and returns a `targetId` that the renderer can reuse across playlist, XMLTV, Xtream, and Stalker requests. The URL itself stays in the backend process; downstream routes must resolve the ID through `getRegisteredProviderUrl` instead of accepting an arbitrary URL for the proxy request.

## Resource policy

- The registry retains at most 1,024 distinct validated targets per process.
- Reads refresh recency. Adding a new target at capacity evicts the least recently used entry.
- Re-registering the same normalized URL reuses its deterministic SHA-256 ID and refreshes the existing entry instead of consuming another slot.
- A target evicted under pressure returns the existing `404 Provider target not found` response. The client must register the URL again before retrying. It must not bypass the registry by sending a raw URL to proxy routes.

The registry is process-local and is not a credential store or persistence layer. Restarting the backend clears all entries. The cap bounds accumulation from repeated unique registrations; it does not replace URL validation, request timeouts, response-size limits, or any deployment-level authentication and rate limiting.
