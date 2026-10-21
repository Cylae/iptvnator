import type { Socket } from 'node:net';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';

export const DEFAULT_MAX_PROVIDER_RESPONSE_BYTES = 128 * 1024 * 1024;
/**
 * Process-wide limit for the sum of streamed response chunks and temporary
 * concatenated/decoded buffers. Parsed JSON object graphs are additional
 * memory and are not included in this accounting.
 */
export const DEFAULT_MAX_IN_FLIGHT_PROVIDER_BODY_BYTES = 512 * 1024 * 1024;

/** A fail-fast budget shared by all streamed provider-body readers in a process. */
export class ProviderResponseMemoryBudget {
    private reserved = 0;

    constructor(
        readonly maxBytes: number =
            DEFAULT_MAX_IN_FLIGHT_PROVIDER_BODY_BYTES
    ) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
            throw new RangeError('maxBytes must be a positive safe integer');
        }
    }

    tryReserve(bytes: number): boolean {
        if (!Number.isSafeInteger(bytes) || bytes < 0) {
            throw new RangeError('bytes must be a non-negative safe integer');
        }
        if (bytes > this.maxBytes - this.reserved) return false;
        this.reserved += bytes;
        return true;
    }

    release(bytes: number): void {
        if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.reserved) {
            throw new RangeError('release would exceed the reserved byte budget');
        }
        this.reserved -= bytes;
    }

    get reservedBytes(): number {
        return this.reserved;
    }
}

export const providerResponseMemoryBudget =
    new ProviderResponseMemoryBudget();

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

export class ProviderResponseMemoryLimitError extends Error {
    readonly code = 'ERR_PROVIDER_RESPONSE_MEMORY_LIMIT';

    constructor(
        readonly maxBytes: number,
        readonly reservedBytes: number,
        readonly requestedBytes: number
    ) {
        super('Concurrent provider response buffering capacity is exhausted');
        this.name = 'ProviderResponseMemoryLimitError';
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
    maxResponseBytes = DEFAULT_MAX_PROVIDER_RESPONSE_BYTES,
    memoryBudget: ProviderResponseMemoryBudget = providerResponseMemoryBudget
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
    let reservedBytes = 0;
    const reserve = (bytes: number): void => {
        if (!memoryBudget.tryReserve(bytes)) {
            throw new ProviderResponseMemoryLimitError(
                memoryBudget.maxBytes,
                memoryBudget.reservedBytes,
                bytes
            );
        }
        reservedBytes += bytes;
    };
    const release = (bytes: number): void => {
        memoryBudget.release(bytes);
        reservedBytes -= bytes;
    };

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
            if (!memoryBudget.tryReserve(buffer.byteLength)) {
                data.destroy();
                throw new ProviderResponseMemoryLimitError(
                    memoryBudget.maxBytes,
                    memoryBudget.reservedBytes,
                    buffer.byteLength
                );
            }
            reservedBytes += buffer.byteLength;
            bytesRead += buffer.byteLength;
            chunks.push(buffer);
        }

        // Buffer.concat temporarily holds the chunks and the assembled output.
        // Reserve that second copy before allocating it.
        reserve(bytesRead);
        const buffer = Buffer.concat(chunks, bytesRead);
        chunks.length = 0;
        release(bytesRead);

        if (arraybuffer) return buffer as T;

        // UTF-16 decoding can need up to two bytes per input byte. Account for
        // it conservatively before creating the text representation.
        reserve(buffer.byteLength * 2);
        let text: string;
        try {
            text = buffer.toString('utf8').replace(/^\uFEFF/, '');
        } finally {
            release(buffer.byteLength);
        }
        try {
            return JSON.parse(text) as T;
        } catch {
            return text as T;
        }
    } finally {
        if (reservedBytes > 0) {
            memoryBudget.release(reservedBytes);
        }
        if (timeout && socket) {
            socket.removeListener('timeout', onTimeout);
            socket.setTimeout(0);
        }
    }
}

function getByteLength(value: unknown): number | undefined {
    if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
    if (Buffer.isBuffer(value)) return value.byteLength;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    return undefined;
}
