import {
    MAX_PROVIDER_TARGETS,
    ProviderTargetRegistry,
} from './provider-target-registry';

describe('ProviderTargetRegistry', () => {
    it('keeps the number of retained URLs at or below the configured capacity', () => {
        const registry = new ProviderTargetRegistry(2);
        const first = new URL('https://first.example/playlist.m3u');
        const second = new URL('https://second.example/playlist.m3u');
        const third = new URL('https://third.example/playlist.m3u');

        const firstId = registry.register(first);
        const secondId = registry.register(second);
        const thirdId = registry.register(third);

        expect(registry.size).toBe(2);
        expect(registry.resolve(firstId)).toBeUndefined();
        expect(registry.resolve(secondId)?.href).toBe(second.href);
        expect(registry.resolve(thirdId)?.href).toBe(third.href);
    });

    it('refreshes recency on resolve so active targets survive eviction', () => {
        const registry = new ProviderTargetRegistry(2);
        const first = new URL('https://first.example/playlist.m3u');
        const second = new URL('https://second.example/playlist.m3u');
        const third = new URL('https://third.example/playlist.m3u');

        const firstId = registry.register(first);
        const secondId = registry.register(second);

        expect(registry.resolve(firstId)?.href).toBe(first.href);
        registry.register(third);

        expect(registry.resolve(firstId)?.href).toBe(first.href);
        expect(registry.resolve(secondId)).toBeUndefined();
    });

    it('refreshes an existing target without creating duplicate entries', () => {
        const registry = new ProviderTargetRegistry(2);
        const target = new URL('https://provider.example/playlist.m3u');

        const firstId = registry.register(target);
        const secondId = registry.register(new URL(target.href));

        expect(secondId).toBe(firstId);
        expect(registry.size).toBe(1);
    });

    it('returns an isolated URL so callers cannot mutate the retained target', () => {
        const registry = new ProviderTargetRegistry(2);
        const targetId = registry.register(
            new URL('https://provider.example/playlist.m3u')
        );

        const resolved = registry.resolve(targetId);
        if (!resolved) {
            throw new Error('Expected registered target to resolve');
        }
        resolved.hostname = 'attacker.example';

        expect(registry.resolve(targetId)?.hostname).toBe('provider.example');
    });

    it('uses a conservative finite default capacity', () => {
        const registry = new ProviderTargetRegistry();

        expect(MAX_PROVIDER_TARGETS).toBe(1024);
        expect(registry.size).toBe(0);
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
        'rejects invalid capacity %s',
        (capacity) => {
            expect(() => new ProviderTargetRegistry(capacity)).toThrow(
                'maxEntries must be a positive safe integer'
            );
        }
    );
});
