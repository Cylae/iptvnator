import { MAX_REMOTE_M3U_BYTES } from '@iptvnator/shared/m3u-utils';
import { createPlaylistAgentFactory } from './secure-https';
import type { ValidatedAxiosRequestConfig } from './validated-axios';

/**
 * Idle timeout for remote playlist downloads. Without it, a host that accepts
 * the connection and then goes silent can stall unattended auto-refresh.
 */
export const PLAYLIST_FETCH_TIMEOUT_MS = 30000;

/** Bound decompressed M3U bodies before parsing allocates channel objects. */
export const PLAYLIST_MAX_RESPONSE_BYTES = MAX_REMOTE_M3U_BYTES;

/**
 * Canonical policy for remote M3U requests from normal imports and worker
 * refreshes. Keep timeout, TLS trust, cancellation, and size limits identical.
 */
export function createPlaylistRequestConfig(options: {
    userAgent?: string;
    trustedInsecureTlsHosts?: readonly string[];
    signal?: AbortSignal;
} = {}): ValidatedAxiosRequestConfig {
    const userAgent = options.userAgent?.trim() || undefined;
    return {
        agentFactory: createPlaylistAgentFactory({
            trustedInsecureTlsHosts: options.trustedInsecureTlsHosts,
        }),
        method: 'GET',
        ...(userAgent ? { headers: { 'User-Agent': userAgent } } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        timeout: PLAYLIST_FETCH_TIMEOUT_MS,
        maxContentLength: PLAYLIST_MAX_RESPONSE_BYTES,
    };
}
