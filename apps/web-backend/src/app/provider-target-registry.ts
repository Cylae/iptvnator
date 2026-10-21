import { createHash } from 'node:crypto';

/**
 * Maximum number of distinct remote URLs retained by one web-backend process.
 * Provider targets can contain credentials and are kept in memory, so the
 * registry must stay bounded even when clients register unlimited URLs.
 */
export const MAX_PROVIDER_TARGETS = 1024;

/** Maximum simultaneous DNS/URL validations admitted by the PWA backend. */
export const MAX_CONCURRENT_PROVIDER_TARGET_VALIDATIONS = 16;

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


/**
 * Fail-fast admission gate for expensive provider URL/DNS validation.
 *
 * The target LRU bounds retained state; this gate separately bounds active
 * validations so a burst of distinct URLs cannot create unlimited concurrent
 * DNS work. Callers that cannot acquire a slot should return a retryable 503.
 */
export class ProviderTargetValidationGate {
    private active = 0;

    constructor(
        private readonly maxConcurrent: number =
            MAX_CONCURRENT_PROVIDER_TARGET_VALIDATIONS
    ) {
        if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) {
            throw new RangeError(
                'maxConcurrent must be a positive safe integer'
            );
        }
    }

    tryAcquire(): (() => void) | null {
        if (this.active >= this.maxConcurrent) {
            return null;
        }

        this.active++;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.active--;
        };
    }

    get activeCount(): number {
        return this.active;
    }
}
