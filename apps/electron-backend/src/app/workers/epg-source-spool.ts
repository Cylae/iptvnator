import {
    closeSync,
    createWriteStream,
    mkdtempSync,
    openSync,
    readSync,
    rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
    StreamingEpgParser,
    type ParsedChannel,
    type ParsedProgram,
} from './epg-streaming-parser';

export interface EpgSourceImportCallbacks {
    readonly onChannelsBatch: (channels: ParsedChannel[]) => void;
    readonly onProgramsBatch: (programs: ParsedProgram[]) => void;
    readonly onProgress: (channels: number, programs: number) => void;
}

export interface EpgSourceImportStats {
    readonly totalChannels: number;
    readonly totalPrograms: number;
}

export type EpgTransactionRunner = <T>(operation: () => T) => T;

const EMPTY_EPG_SOURCE_MESSAGE =
    'EPG parse produced 0 channels — feed may be unreachable or unsupported';
const SPOOL_BUFFER_BYTES = 64 * 1024;

/**
 * Spool and validate the entire decoded source before changing active guide
 * rows. The spool stays bounded by the upstream decoded-byte limiter, and the
 * database transaction only runs while replaying this local file.
 */
export async function importEpgSourceAtomically(
    source: Readable,
    callbacks: EpgSourceImportCallbacks,
    runInTransaction: EpgTransactionRunner
): Promise<EpgSourceImportStats> {
    const temporaryDirectory = mkdtempSync(
        join(tmpdir(), 'iptvnator-epg-import-')
    );
    const spoolPath = join(temporaryDirectory, 'source.xmltv');

    try {
        const validationParser = new StreamingEpgParser(
            () => undefined,
            () => undefined,
            callbacks.onProgress
        );
        const validationDecoder = new StringDecoder('utf8');
        const validateAndStore = new Transform({
            transform(chunk, _encoding, callback) {
                try {
                    const decoded = validationDecoder.write(
                        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
                    );
                    if (decoded) validationParser.write(decoded);
                    callback(null, chunk);
                } catch (error) {
                    callback(asError(error));
                }
            },
            flush(callback) {
                try {
                    const finalText = validationDecoder.end();
                    if (finalText) validationParser.write(finalText);
                    const stats = validationParser.finish();
                    if (stats.totalChannels === 0) {
                        callback(new Error(EMPTY_EPG_SOURCE_MESSAGE));
                        return;
                    }
                    callback();
                } catch (error) {
                    callback(asError(error));
                }
            },
        });

        await pipeline(
            source,
            validateAndStore,
            createWriteStream(spoolPath, { flags: 'wx', mode: 0o600 })
        );

        return runInTransaction(() => {
            const stats = parseSpool(spoolPath, {
                ...callbacks,
                // Progress was reported during validation. Do not send lower
                // counters again as the validated spool is replayed for writes.
                onProgress: () => undefined,
            });
            if (stats.totalChannels === 0) {
                throw new Error(EMPTY_EPG_SOURCE_MESSAGE);
            }
            return stats;
        });
    } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
    }
}

function parseSpool(
    path: string,
    callbacks: EpgSourceImportCallbacks
): EpgSourceImportStats {
    const descriptor = openSync(path, 'r');
    const buffer = Buffer.allocUnsafe(SPOOL_BUFFER_BYTES);
    const decoder = new StringDecoder('utf8');
    const parser = new StreamingEpgParser(
        callbacks.onChannelsBatch,
        callbacks.onProgramsBatch,
        callbacks.onProgress
    );

    try {
        while (true) {
            const bytesRead = readSync(
                descriptor,
                buffer,
                0,
                buffer.byteLength,
                null
            );
            if (bytesRead === 0) break;
            const decoded = decoder.write(buffer.subarray(0, bytesRead));
            if (decoded) parser.write(decoded);
        }

        const finalText = decoder.end();
        if (finalText) parser.write(finalText);
        return parser.finish();
    } finally {
        closeSync(descriptor);
    }
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
