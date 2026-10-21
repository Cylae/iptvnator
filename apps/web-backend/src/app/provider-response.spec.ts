import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import {
    gunzipProviderBody,
    DEFAULT_MAX_IN_FLIGHT_PROVIDER_BODY_BYTES,
    ProviderResponseMemoryBudget,
    ProviderResponseTooLargeError,
    readProviderBody,
} from './provider-response';

describe('gunzipProviderBody output size limits', () => {
    it('accepts decompressed data at the configured limit', () => {
        expect(
            gunzipProviderBody(gzipSync(Buffer.from('bounded')), 7).toString()
        ).toBe('bounded');
    });

    it('rejects gzip expansion past the configured limit', () => {
        expect(() =>
            gunzipProviderBody(gzipSync(Buffer.from('too much output')), 4)
        ).toThrow(ProviderResponseTooLargeError);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
        'rejects invalid gzip output limit %s before decompression',
        (maxOutputBytes) => {
            expect(() =>
                gunzipProviderBody(
                    gzipSync(Buffer.from('payload')),
                    maxOutputBytes
                )
            ).toThrow(
                'maxOutputBytes must be a positive safe integer'
            );
        }
    );
});

describe('readProviderBody response size limits', () => {
    it('accepts a body exactly at the byte limit', async () => {
        const source = Readable.from([Buffer.from('1234'), Buffer.from('5678')]);

        await expect(
            readProviderBody(source, true, undefined, undefined, 8)
        ).resolves.toEqual(Buffer.from('12345678'));
        expect(source.readableEnded).toBe(true);
    });

    it('strips a UTF-8 BOM from buffered text responses', async () => {
        const source = Readable.from([Buffer.from('\uFEFFhello', 'utf8')]);

        await expect(
            readProviderBody(source, false, undefined, undefined, 32)
        ).resolves.toBe('hello');
    });

    it('counts encoded bytes rather than JavaScript characters', async () => {
        const source = Readable.from([Buffer.from('é', 'utf8')]);

        await expect(
            readProviderBody(source, false, undefined, undefined, 1)
        ).rejects.toBeInstanceOf(ProviderResponseTooLargeError);
        expect(source.destroyed).toBe(true);
    });

    it('stops and rejects when a streamed response crosses the limit', async () => {
        const source = Readable.from([
            Buffer.from('1234'),
            Buffer.from('5678'),
            Buffer.from('must not be consumed'),
        ]);

        await expect(
            readProviderBody(source, true, undefined, undefined, 5)
        ).rejects.toMatchObject({
            code: 'ERR_PROVIDER_RESPONSE_TOO_LARGE',
            maxBytes: 5,
        });
        expect(source.destroyed).toBe(true);
    });

    it('releases shared reservations after successful body buffering', async () => {
        const budget = new ProviderResponseMemoryBudget(32);
        const source = Readable.from([Buffer.from('test')]);

        await expect(
            readProviderBody(source, false, undefined, undefined, 8, budget)
        ).resolves.toBe('test');

        expect(budget.reservedBytes).toBe(0);
    });

    it('rejects a body when other in-flight reads exhaust the shared budget', async () => {
        const budget = new ProviderResponseMemoryBudget(12);
        expect(budget.tryReserve(8)).toBe(true);
        const source = Readable.from([Buffer.from('12345')]);

        await expect(
            readProviderBody(source, true, undefined, undefined, 8, budget)
        ).rejects.toMatchObject({
            code: 'ERR_PROVIDER_RESPONSE_MEMORY_LIMIT',
            maxBytes: 12,
            reservedBytes: 8,
            requestedBytes: 5,
        });

        expect(source.destroyed).toBe(true);
        expect(budget.reservedBytes).toBe(8);
        budget.release(8);
        expect(budget.reservedBytes).toBe(0);
    });

    it('reserves the concatenation peak before allocating the output buffer', async () => {
        const budget = new ProviderResponseMemoryBudget(12);
        const source = Readable.from([Buffer.from('12345678')]);

        await expect(
            readProviderBody(source, true, undefined, undefined, 8, budget)
        ).rejects.toMatchObject({
            code: 'ERR_PROVIDER_RESPONSE_MEMORY_LIMIT',
            maxBytes: 12,
            reservedBytes: 8,
            requestedBytes: 8,
        });

        expect(budget.reservedBytes).toBe(0);
    });

    it('defines a finite default body-buffer budget', () => {
        expect(DEFAULT_MAX_IN_FLIGHT_PROVIDER_BODY_BYTES).toBe(
            512 * 1024 * 1024
        );
        expect(new ProviderResponseMemoryBudget().reservedBytes).toBe(0);
    });

    it('rejects invalid response limits instead of silently disabling the cap', async () => {
        const source = Readable.from([Buffer.from('data')]);

        await expect(
            readProviderBody(source, true, undefined, undefined, Number.NaN)
        ).rejects.toThrow('maxResponseBytes must be a non-negative safe integer');
        expect(source.destroyed).toBe(false);
    });
});
