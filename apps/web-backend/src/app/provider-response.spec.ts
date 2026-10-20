import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import {
    decodeXmltvResponse,
    MAX_PROVIDER_RESPONSE_BYTES,
    MAX_XMLTV_DECOMPRESSED_BYTES,
    ProviderResponseTooLargeError,
    readProviderBody,
} from './provider-response';

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
    return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
}

describe('readProviderBody', () => {
    it('preserves JSON, BOM-prefixed text, and binary response behavior', async () => {
        await expect(
            readProviderBody(
                Readable.from([Buffer.from('{"ok":true}')]),
                false
            )
        ).resolves.toEqual({ ok: true });

        await expect(
            readProviderBody(
                Readable.from([Buffer.from('\uFEFFhello')]),
                false
            )
        ).resolves.toBe('hello');

        const bytes = Buffer.from([0, 255, 128]);
        await expect(
            readProviderBody(Readable.from([bytes]), true)
        ).resolves.toEqual(bytes);
    });

    it('accepts a response whose streamed bytes are exactly at the limit', async () => {
        const body = Readable.from([
            Buffer.from('123'),
            Buffer.from('45'),
        ]);

        await expect(readProviderBody(body, false, undefined, undefined, 5))
            .resolves.toBe('12345');
    });

    it('stops and rejects a streamed body that exceeds the limit', async () => {
        const body = Readable.from([
            Buffer.from('1234'),
            Buffer.from('56'),
            Buffer.from('unread'),
        ]);

        await expect(
            readProviderBody(body, false, undefined, undefined, 5)
        ).rejects.toBeInstanceOf(ProviderResponseTooLargeError);
        expect(body.destroyed).toBe(true);
    });

    it('also rejects oversized already-buffered payloads from injected transports', async () => {
        await expect(
            readProviderBody('123456', false, undefined, undefined, 5)
        ).rejects.toBeInstanceOf(ProviderResponseTooLargeError);

        await expect(
            readProviderBody(Buffer.from('123456'), true, undefined, undefined, 5)
        ).rejects.toBeInstanceOf(ProviderResponseTooLargeError);
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
        'rejects invalid body limit %s',
        async (maxBytes) => {
            await expect(
                readProviderBody(
                    Readable.from([Buffer.from('body')]),
                    false,
                    undefined,
                    undefined,
                    maxBytes
                )
            ).rejects.toThrow('maxBytes must be a positive safe integer');
        }
    );

    it('publishes a finite default provider response limit', () => {
        expect(MAX_PROVIDER_RESPONSE_BYTES).toBe(64 * 1024 * 1024);
    });
});

describe('decodeXmltvResponse', () => {
    it('decodes standalone gzip XMLTV data', () => {
        const xml = '<?xml version="1.0"?><tv><channel id="one"/></tv>';
        expect(
            decodeXmltvResponse(toArrayBuffer(gzipSync(xml)), true)
        ).toBe(xml);
    });

    it('preserves uncompressed XMLTV text without changing its content', () => {
        const xml = '<?xml version="1.0"?><tv><channel id="one"/></tv>';
        expect(decodeXmltvResponse(xml, false)).toBe(xml);
    });

    it('rejects gzip expansion beyond the decoded XMLTV limit', () => {
        const compressed = toArrayBuffer(gzipSync(Buffer.alloc(1024, 0x61)));

        expect(() =>
            decodeXmltvResponse(compressed, true, 128)
        ).toThrow(ProviderResponseTooLargeError);
    });

    it('does not misreport malformed gzip as a size violation', () => {
        expect(() =>
            decodeXmltvResponse(toArrayBuffer(Buffer.from('not gzip')), true)
        ).toThrow();
        expect(MAX_XMLTV_DECOMPRESSED_BYTES).toBe(MAX_PROVIDER_RESPONSE_BYTES);
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
        'rejects invalid decompressed XMLTV limit %s',
        (maxOutputBytes) => {
            expect(() =>
                decodeXmltvResponse(
                    toArrayBuffer(gzipSync('xml')),
                    true,
                    maxOutputBytes
                )
            ).toThrow(
                'maxOutputBytes must be a positive safe integer'
            );
        }
    );
});
