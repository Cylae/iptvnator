import { Readable } from 'node:stream';
import {
    importEpgSourceAtomically,
    type EpgSourceImportCallbacks,
} from './epg-source-spool';
import type { ParsedChannel, ParsedProgram } from './epg-streaming-parser';

const validXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<tv><channel id="channel-1"><display-name>Chaîne News</display-name></channel>' +
    '<programme channel="channel-1" start="20261021090000 +0000" stop="20261021100000 +0000">' +
    '<title>Morning News</title></programme></tv>';

function noOpCallbacks(): EpgSourceImportCallbacks {
    return {
        onChannelsBatch: () => undefined,
        onProgramsBatch: () => undefined,
        onProgress: () => undefined,
    };
}

describe('importEpgSourceAtomically', () => {
    it('preserves UTF-8 characters split across source chunks', async () => {
        const encoded = Buffer.from(validXml, 'utf8');
        const split = encoded.indexOf(Buffer.from('î', 'utf8')) + 1;
        const parsedChannels: ParsedChannel[] = [];
        const parsedPrograms: ParsedProgram[] = [];
        let transactionCalls = 0;

        const stats = await importEpgSourceAtomically(
            Readable.from([encoded.subarray(0, split), encoded.subarray(split)]),
            {
                onChannelsBatch: (channels) => parsedChannels.push(...channels),
                onProgramsBatch: (programs) => parsedPrograms.push(...programs),
                onProgress: () => undefined,
            },
            (operation) => {
                transactionCalls++;
                return operation();
            }
        );

        expect(stats).toEqual({ totalChannels: 1, totalPrograms: 1 });
        expect(transactionCalls).toBe(1);
        expect(parsedChannels[0].displayName[0].value).toBe('Chaîne News');
        expect(parsedPrograms[0].title[0].value).toBe('Morning News');
    });

    it('rejects a malformed feed late in preflight before opening a database transaction', async () => {
        const channels = Array.from(
            { length: 101 },
            (_, index) =>
                `<channel id="channel-${index}"><display-name>Channel ${index}</display-name></channel>`
        ).join('');
        const malformed = `<tv>${channels}</not-tv>`;
        const callbacks = {
            ...noOpCallbacks(),
            onChannelsBatch: jest.fn(),
            onProgramsBatch: jest.fn(),
        };
        const runInTransaction = jest.fn(
            <T>(operation: () => T): T => operation()
        );

        await expect(
            importEpgSourceAtomically(
                Readable.from([Buffer.from(malformed)]),
                callbacks,
                runInTransaction
            )
        ).rejects.toThrow();

        expect(runInTransaction).not.toHaveBeenCalled();
        expect(callbacks.onChannelsBatch).not.toHaveBeenCalled();
        expect(callbacks.onProgramsBatch).not.toHaveBeenCalled();
    });

    it('does not replace stored guide data with an empty XMLTV document', async () => {
        const runInTransaction = jest.fn(
            <T>(operation: () => T): T => operation()
        );

        await expect(
            importEpgSourceAtomically(
                Readable.from([Buffer.from('<tv></tv>')]),
                noOpCallbacks(),
                runInTransaction
            )
        ).rejects.toThrow(
            'EPG parse produced 0 channels — feed may be unreachable or unsupported'
        );

        expect(runInTransaction).not.toHaveBeenCalled();
    });

    it('leaves existing state intact if a write fails during transactional replay', async () => {
        let storedRows = ['previous-guide'];
        let transactionCalls = 0;
        const failure = new Error('simulated batch write failure');

        const runInTransaction = <T>(operation: () => T): T => {
            transactionCalls++;
            const snapshot = [...storedRows];
            try {
                return operation();
            } catch (error) {
                storedRows = snapshot;
                throw error;
            }
        };

        await expect(
            importEpgSourceAtomically(
                Readable.from([Buffer.from(validXml)]),
                {
                    onChannelsBatch: (channels) => {
                        storedRows.push(...channels.map((channel) => channel.id));
                    },
                    onProgramsBatch: () => {
                        throw failure;
                    },
                    onProgress: () => undefined,
                },
                runInTransaction
            )
        ).rejects.toBe(failure);

        expect(transactionCalls).toBe(1);
        expect(storedRows).toEqual(['previous-guide']);
    });
});
