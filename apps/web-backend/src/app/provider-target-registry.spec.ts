import {
    MAX_PROVIDER_TARGET_REGISTRY_ENTRIES,
    ProviderTargetRegistry,
} from './provider-target-registry';

describe('ProviderTargetRegistry', () => {
    it('uses a finite default capacity', () => {
        expect(MAX_PROVIDER_TARGET_REGISTRY_ENTRIES).toBe(1_024);
        expect(new ProviderTargetRegistry().size).toBe(0);
    });

    it('evicts the least recently used entry when capacity is reached', () => {
        const registry = new ProviderTargetRegistry(2);
        const first = new URL('https://first.example');
        const second = new URL('https://second.example');
        const third = new URL('https://third.example');

        registry.set('first', first);
        registry.set('second', second);
        expect(registry.get('first')).toBe(first);

        registry.set('third', third);

        expect(registry.size).toBe(2);
        expect(registry.has('second')).toBe(false);
        expect(registry.get('first')).toBe(first);
        expect(registry.get('third')).toBe(third);
    });

    it('refreshes a replaced entry without growing past capacity', () => {
        const registry = new ProviderTargetRegistry(2);
        const first = new URL('https://first.example');
        const replacement = new URL('https://first.example/new');
        const second = new URL('https://second.example');
        const third = new URL('https://third.example');

        registry.set('first', first);
        registry.set('second', second);
        registry.set('first', replacement);
        registry.set('third', third);

        expect(registry.size).toBe(2);
        expect(registry.has('second')).toBe(false);
        expect(registry.get('first')).toBe(replacement);
        expect(registry.get('third')).toBe(third);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
        'rejects invalid capacity %s',
        (maxEntries) => {
            expect(() => new ProviderTargetRegistry(maxEntries)).toThrow(
                'maxEntries must be a positive safe integer'
            );
        }
    );
});
