import {
    Duplex,
    PassThrough,
    Readable,
    Transform,
    pipeline,
} from 'stream';
import type { TransformCallback } from 'stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'zlib';
import {
    EpgResponseContentEncoding,
    getEpgResponseContentEncodings,
    HeaderReader,
} from './epg-response-utils';
import { createOptionalEpgGunzip } from './epg-optional-gunzip';

/** Maximum decoded XMLTV bytes accepted for one EPG source. */
export const MAX_DECODED_EPG_RESPONSE_BYTES = 256 * 1024 * 1024;

export class EpgResponseTooLargeError extends Error {
    readonly code = 'ERR_EPG_RESPONSE_TOO_LARGE';

    constructor(readonly maxBytes: number) {
        super(`Decoded EPG response exceeded the ${maxBytes}-byte limit`);
        this.name = 'EpgResponseTooLargeError';
    }
}

/** Count bytes after all decompression layers to stop compressed expansion. */
export function createEpgByteLimitTransform(
    maxBytes = MAX_DECODED_EPG_RESPONSE_BYTES
): Transform {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
        throw new RangeError(
            'maxBytes must be a non-negative safe integer'
        );
    }

    let bytesRead = 0;
    return new Transform({
        transform(
            chunk: Buffer | string,
            encoding: BufferEncoding,
            callback: TransformCallback
        ) {
            const byteLength = Buffer.byteLength(chunk, encoding);
            if (byteLength > maxBytes - bytesRead) {
                callback(new EpgResponseTooLargeError(maxBytes));
                return;
            }

            bytesRead += byteLength;
            callback(null, chunk);
        },
    });
}

function createContentEncodingDecoder(
    contentEncoding: EpgResponseContentEncoding
): Transform {
    switch (contentEncoding) {
        case 'br':
            return createBrotliDecompress();
        case 'gzip':
            return createGunzip();
        case 'deflate':
            return createInflate();
    }
}

export function createDecodedEpgStream(
    source: Readable,
    headers: HeaderReader,
    shouldGunzipPayload: boolean,
    maxDecodedBytes = MAX_DECODED_EPG_RESPONSE_BYTES
): Readable {
    const contentEncodings = getEpgResponseContentEncodings(headers);
    const transforms: Duplex[] = contentEncodings.map(
        createContentEncodingDecoder
    );

    if (shouldGunzipPayload) {
        transforms.push(
            contentEncodings.includes('gzip')
                ? createOptionalEpgGunzip()
                : createGunzip()
        );
    }

    // Keep the limit last: it must observe decoded bytes, not compressed input.
    transforms.push(createEpgByteLimitTransform(maxDecodedBytes));

    const output = new PassThrough();
    pipeline([source, ...transforms, output], (error) => {
        if (error) {
            output.destroy(error);
        }
    });

    return output;
}
