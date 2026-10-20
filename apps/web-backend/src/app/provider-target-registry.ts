/** Maximum number of distinct validated provider URLs retained per backend process. */
export const MAX_PROVIDER_TARGET_REGISTRY_ENTRIES = 1024;

/**
 * Bounded least-recently-used registry for validated provider URLs.
 *
 * A request refreshes its entry's recency. When the registry is full, adding a
 * new target evicts the least recently used entry instead of allowing URLs to
 * accumulate without a process-lifetime bound.
 */
export class ProviderTargetRegistry extends Map<string, URL> {
    constructor(
        private readonly maxEntries = MAX_PROVIDER_TARGET_REGISTRY_ENTRIES
    ) {
        super();
        if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
            throw new RangeError('maxEntries must be a positive safe integer');
        }
    }

    override get(key: string): URL | undefined {
        const value = super.get(key);
        if (value) {
            super.delete(key);
            super.set(key, value);
        }
        return value;
    }

    override set(key: string, value: URL): this {
        super.delete(key);
        super.set(key, value);

        while (this.size > this.maxEntries) {
            const oldestKey = this.keys().next().value;
            if (oldestKey === undefined) break;
            super.delete(oldestKey);
        }
        return this;
    }
}
