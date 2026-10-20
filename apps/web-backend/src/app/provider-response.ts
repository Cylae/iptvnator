import { Socket } from 'node:net';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';

/** Maximum decoded provider payload buffered by the self-hosted backend. */
export const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024 * 1024;

/** XMLTV gzip files must not expand beyond the same buffered response ceiling. */
export const MAX_XMLTV_DECOMPRESSED_BYTES = MAX_PROVIDER_RESPONSE_BYTES;

/** Stable, URL-free error for response-size violations. */
export class ProviderResponseTooLargeError extends Error {
    readonly code = 'ERR_PROVIDER_RESPONSE_TOO_LARGE';

    constructor(limitBytes: number, payload = 'Provider response') {
        super(`${payload} exceeded the ${limitBytes}-byte size limit`);
        this.name = 'ProviderResponseTooLargeError';
    }
}

/** Redirect bodies are irrelevant, including invalid gzip and endless bodies. */
export function discardProviderBody(data: unknown): void {
    if (data instanceof Readable) data.destroy();
}

export function discardProviderErrorBody(error: unknown): void {
    const response = (error as { response?: { data?: unknown } } | null)
        ?.response;
    discardProviderBody(response?.data);
}

/**
 * Match axios's buffered default and arraybuffer modes for the final hop.
 *
 * The size ceiling is enforced against bytes actually emitted by the stream,
 * rather than trusting Content-Length, which may be absent or incorrect.
 */
export async function readProviderBody<T>(
    data: T,
    arraybuffer: boolean,
    timeout?: number,
    socket?: Socket,
    maxBytes = MAX_PROVIDER_RESPONSE_BYTES
): Promise<T> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        throw new RangeError('maxBytes must be a positive safe integer');
    }

    if (!(data instanceof Readable)) {
        const bufferedBytes = getBufferedByteLength(data);
        if (bufferedBytes !== undefined && bufferedBytes > maxBytes) {
            throw new ProviderResponseTooLargeError(maxBytes);
        }
        return data;
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    // Axios resolves stream responses at headers and then ignores its own
    // request timeout callback. Keep the native socket's inactivity timer
    // alive until the body finishes; arriving wire bytes reset it, even if
    // decompression has not emitted another decoded chunk yet.
    const onTimeout = () =>
        data.destroy(
            Object.assign(new Error('Provider response body timed out'), {
                code: 'ECONNABORTED',
            })
        );
    if (timeout && socket) socket.setTimeout(timeout, onTimeout);
    try {
        for await (const chunk of data) {
            const buffer = Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk);
            totalBytes += buffer.byteLength;
            if (totalBytes > maxBytes) {
                // Close the response immediately instead of buffering an
                // attacker-controlled endless stream or waiting for timeout.
                data.destroy();
                throw new ProviderResponseTooLargeError(maxBytes);
            }
            chunks.push(buffer);
        }
    } finally {
        if (timeout && socket) {
            socket.removeListener('timeout', onTimeout);
            socket.setTimeout(0);
        }
    }

    const buffer = Buffer.concat(chunks, totalBytes);
    if (arraybuffer) return buffer as T;
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    try {
        return JSON.parse(text) as T;
    } catch {
        return text as T;
    }
}

function getBufferedByteLength(data: unknown): number | undefined {
    if (typeof data === 'string') return Buffer.byteLength(data, 'utf8');
    if (Buffer.isBuffer(data)) return data.byteLength;
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        return data.byteLength;
    }
    return undefined;
}

/** Decode an XMLTV response while bounding the expansion of standalone .gz files. */
export function decodeXmltvResponse(
    data: ArrayBuffer | string,
    isGzippedFile: boolean,
    maxOutputBytes = MAX_XMLTV_DECOMPRESSED_BYTES
): string {
    if (!isGzippedFile) {
        return typeof data === 'string'
            ? data
            : Buffer.from(data).toString('utf8');
    }
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
        throw new RangeError('maxOutputBytes must be a positive safe integer');
    }

    const compressed =
        typeof data === 'string'
            ? Buffer.from(data, 'utf8')
            : Buffer.from(data);
    try {
        return gunzipSync(compressed, {
            maxOutputLength: maxOutputBytes,
        }).toString('utf8');
    } catch (error) {
        if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'ERR_BUFFER_TOO_LARGE'
        ) {
            throw new ProviderResponseTooLargeError(
                maxOutputBytes,
                'Decompressed XMLTV response'
            );
        }
        throw error;
    }
}
