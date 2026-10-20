import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

describe('database initialization retry after failure', () => {
    it(
        'retries successfully when the initial data path cannot be opened',
        () => {
            const dataDir = mkdtempSync(
                join(tmpdir(), 'iptvnator-init-retry-')
            );
            const invalidRootDir = mkdtempSync(
                join(tmpdir(), 'iptvnator-invalid-root-')
            );
            const invalidRoot = join(invalidRootDir, 'not-a-directory');
            writeFileSync(invalidRoot, 'intentionally not a directory');

            const electronPath = createRequire(__filename)(
                'electron'
            ) as string;
            const connectionUrl = pathToFileURL(
                resolve(__dirname, 'connection.ts')
            ).href;
            const script = `
                import assert from 'node:assert/strict';
                const { closeDatabase, initDatabase } = await import(
                    ${JSON.stringify(connectionUrl)}
                );
                const validRoot = process.env['IPTVNATOR_E2E_DATA_DIR'];
                assert(validRoot, 'Expected isolated test data directory');
                process.env['IPTVNATOR_E2E_DATA_DIR'] =
                    ${JSON.stringify(invalidRoot)};
                await assert.rejects(initDatabase(), { code: 'ENOTDIR' });
                process.env['IPTVNATOR_E2E_DATA_DIR'] = validRoot;
                try {
                    await initDatabase({ skipTableCreation: true });
                } finally {
                    closeDatabase();
                }
                process.stdout.write('retry verified');
            `;

            try {
                const output = execFileSync(
                    electronPath,
                    ['--import', 'tsx', '--eval', script],
                    {
                        cwd: process.cwd(),
                        encoding: 'utf8',
                        timeout: 30_000,
                        env: {
                            ...process.env,
                            ELECTRON_RUN_AS_NODE: '1',
                            IPTVNATOR_E2E_DATA_DIR: dataDir,
                            TSX_TSCONFIG_PATH: resolve(
                                process.cwd(),
                                'tsconfig.base.json'
                            ),
                        },
                    }
                );
                expect(output).toBe('retry verified');
            } finally {
                rmSync(dataDir, { recursive: true, force: true });
                rmSync(invalidRootDir, { recursive: true, force: true });
            }
        },
        35_000
    );
});

describe('database initialization across skipped releases (#1580)', () => {
    it.each(['0.19.0', '0.20.0', '0.21.0', '0.22.0', '0.23.0', 'fresh'])(
        'preserves %s data and indexes across upgrade and repeated startup',
        (version) => {
            const dataDir = mkdtempSync(join(tmpdir(), 'iptvnator-upgrade-'));
            const electronPath = createRequire(__filename)(
                'electron'
            ) as string;
            const fixture =
                version === 'fresh'
                    ? 'fresh'
                    : resolve(
                          __dirname,
                          'testing/fixtures',
                          `v${version}-schema.sql`
                      );
            try {
                const output = execFileSync(
                    electronPath,
                    [
                        '--import',
                        'tsx',
                        resolve(__dirname, 'testing/connection-upgrade.ts'),
                        fixture,
                    ],
                    {
                        cwd: process.cwd(),
                        encoding: 'utf8',
                        timeout: 30_000,
                        env: {
                            ...process.env,
                            ELECTRON_RUN_AS_NODE: '1',
                            IPTVNATOR_E2E_DATA_DIR: dataDir,
                            TSX_TSCONFIG_PATH: resolve(
                                process.cwd(),
                                'tsconfig.base.json'
                            ),
                        },
                    }
                );
                expect(output).toBe('upgrade verified');
            } finally {
                rmSync(dataDir, { recursive: true, force: true });
            }
        },
        35_000
    );
});
