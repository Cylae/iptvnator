import type { Socket } from 'node:net';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';

export const DEFAULT_MAX_PROVIDER_RESPONSE_BYTES = 128 * 1024 * 1024;

/** Decompress a bounded gzip payload without allowing expansion past the cap. */
export function gunzipProviderBody(
    compressed: Buffer,
    maxOutputBytes: number
): Buffer {
    // Node's zlib maxOutputLength must be at least 1, even for an empty
    // output. Reject invalid settings explicitly instead of leaking ERR_OUT_OF_RANGE.
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
        throw new RangeError(
            'maxOutputBytes must be a positive safe integer'
        );
    }
    try {
        return gunzipSync(compressed, { maxOutputLength: maxOutputBytes });
    } catch (error) {
        if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ERR_BUFFER_TOO_LARGE'
        ) {
            throw new ProviderResponseTooLargeError(maxOutputBytes);
        }
        throw error;
    }
}

export class ProviderResponseTooLargeError extends Error {
    readonly code = 'ERR_PROVIDER_RESPONSE_TOO_LARGE';

    constructor(readonly maxBytes: number) {
        super(`Provider response exceeded the ${maxBytes}-byte limit`);
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

/** Match axios's buffered default and arraybuffer modes for the final hop. */
export async function readProviderBody<T>(
    data: T,
    arraybuffer: boolean,
    timeout?: number,
    socket?: Socket,
    maxResponseBytes = DEFAULT_MAX_PROVIDER_RESPONSE_BYTES
): Promise<T> {
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 0) {
        throw new RangeError(
            'maxResponseBytes must be a non-negative safe integer'
        );
    }

    if (!(data instanceof Readable)) {
        const byteLength = getByteLength(data);
        if (byteLength !== undefined && byteLength > maxResponseBytes) {
            throw new ProviderResponseTooLargeError(maxResponseBytes);
        }
        return data;
    }

    const chunks: Buffer[] = [];
    let bytesRead = 0;
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
            const buffer = Buffer.from(chunk);
            if (buffer.byteLength > maxResponseBytes - bytesRead) {
                data.destroy();
                throw new ProviderResponseTooLargeError(maxResponseBytes);
            }
            bytesRead += buffer.byteLength;
            chunks.push(buffer);
        }
    } finally {
        if (timeout && socket) {
            socket.removeListener('timeout', onTimeout);
            socket.setTimeout(0);
        }
    }
    const buffer = Buffer.concat(chunks);
    if (arraybuffer) return buffer as T;
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    try {
        return JSON.parse(text) as T;
    } catch {
        return text as T;
    }
}

function getByteLength(value: unknown): number | undefined {
    if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
    if (Buffer.isBuffer(value)) return value.byteLength;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    return undefined;
}
