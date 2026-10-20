import { createHash } from 'node:crypto';

/**
 * Maximum number of distinct remote URLs retained by one web-backend process.
 * Provider targets can contain credentials and are kept in memory, so the
 * registry must stay bounded even when clients register unlimited URLs.
 */
export const MAX_PROVIDER_TARGETS = 1024;

/**
 * Bounded least-recently-used registry for URLs that have passed the provider
 * URL policy. Resolving a target refreshes its recency; registering a new URL
 * evicts the least recently used entry when the capacity is reached.
 */
export class ProviderTargetRegistry {
    private readonly entries = new Map<string, URL>();

    constructor(
        private readonly maxEntries: number = MAX_PROVIDER_TARGETS
    ) {
        if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
            throw new RangeError('maxEntries must be a positive safe integer');
        }
    }

    register(url: URL): string {
        const targetId = createProviderTargetId(url);
        this.entries.delete(targetId);
        this.entries.set(targetId, new URL(url.href));

        while (this.entries.size > this.maxEntries) {
            const leastRecentlyUsed = this.entries.keys().next().value;
            if (leastRecentlyUsed === undefined) {
                break;
            }
            this.entries.delete(leastRecentlyUsed);
        }

        return targetId;
    }

    resolve(targetId: string): URL | undefined {
        const url = this.entries.get(targetId);
        if (!url) {
            return undefined;
        }

        this.entries.delete(targetId);
        this.entries.set(targetId, url);
        return new URL(url.href);
    }

    get size(): number {
        return this.entries.size;
    }
}

function createProviderTargetId(url: URL): string {
    return createHash('sha256').update(url.href).digest('hex');
}
