import {
    closeSync,
    createWriteStream,
    type Dirent,
    lstatSync,
    mkdtempSync,
    openSync,
    readSync,
    readdirSync,
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
export const EPG_SPOOL_DIRECTORY_PREFIX = 'iptvnator-epg-import-';
export const DEFAULT_STALE_EPG_SPOOL_AGE_MS = 24 * 60 * 60 * 1000;
const SPOOL_BUFFER_BYTES = 64 * 1024;

/**
 * Best-effort cleanup for spools left by a forcibly terminated worker.
 * Only direct child directories with the application-specific prefix qualify.
 * Both directory and file timestamps must be stale, so active spool writes
 * refresh the grace period.
 */
export function cleanupStaleEpgSpools(
    rootDirectory = tmpdir(),
    now = Date.now(),
    maxAgeMs = DEFAULT_STALE_EPG_SPOOL_AGE_MS
): number {
    if (!Number.isFinite(now)) {
        throw new RangeError('now must be a finite timestamp');
    }
    if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1) {
        throw new RangeError('maxAgeMs must be a positive safe integer');
    }

    let entries: Dirent[];
    try {
        entries = readdirSync(rootDirectory, { withFileTypes: true });
    } catch {
        return 0;
    }

    let removed = 0;
    for (const entry of entries) {
        if (
            !entry.isDirectory() ||
            !entry.name.startsWith(EPG_SPOOL_DIRECTORY_PREFIX)
        ) {
            continue;
        }

        const directoryPath = join(rootDirectory, entry.name);
        try {
            const directoryInfo = lstatSync(directoryPath);
            if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
                continue;
            }

            let lastActivity = directoryInfo.mtimeMs;
            const spoolPath = join(directoryPath, 'source.xmltv');
            try {
                const spoolInfo = lstatSync(spoolPath);
                if (spoolInfo.isSymbolicLink()) continue;
                if (spoolInfo.isFile()) {
                    lastActivity = Math.max(lastActivity, spoolInfo.mtimeMs);
                }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    continue;
                }
            }

            if (now - lastActivity <= maxAgeMs) continue;
            rmSync(directoryPath, { recursive: true, force: true });
            removed++;
        } catch {
            // Cleanup is best-effort; a stale temp file must not block a new import.
        }
    }

    return removed;
}

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
    const temporaryRoot = tmpdir();
    cleanupStaleEpgSpools(temporaryRoot);
    const temporaryDirectory = mkdtempSync(
        join(temporaryRoot, EPG_SPOOL_DIRECTORY_PREFIX)
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
