import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { stringify } from 'yaml';

const validatorPath = fileURLToPath(
    new URL('./check-nx-version-sync.mjs', import.meta.url)
);

const alignedPackageJson = {
    devDependencies: {
        '@nx/angular': '22.7.1',
        nx: '22.7.1',
        'nx-electron': '22.0.0',
    },
};

const alignedPackages = {
    '@nx/angular@22.7.1': {},
    'nx@22.7.1': {},
    'nx-electron@22.0.0': {},
};

async function createFixture(t, { packageJson, packages }) {
    const rootDir = await mkdtemp(join(tmpdir(), 'nx-version-sync-'));
    t.after(() => rm(rootDir, { recursive: true, force: true }));
    await writeFile(
        join(rootDir, 'package.json'),
        `${JSON.stringify(packageJson, null, 2)}\n`
    );
    await writeFile(
        join(rootDir, 'pnpm-lock.yaml'),
        stringify({ lockfileVersion: '9.0', packages })
    );
    return rootDir;
}

function runValidator(rootDir) {
    return spawnSync(process.execPath, [validatorPath], {
        cwd: rootDir,
        encoding: 'utf8',
    });
}

test('accepts aligned official Nx packages and ignores nx-electron', async (t) => {
    const rootDir = await createFixture(t, {
        packageJson: alignedPackageJson,
        packages: alignedPackages,
    });

    const result = runValidator(rootDir);

    assert.equal(result.status, 0, result.stderr);
    assert.match(
        result.stdout,
        /Nx dependency versions are synchronized at 22\.7\.1\./
    );
});

test('rejects a direct official Nx package mismatch', async (t) => {
    const rootDir = await createFixture(t, {
        packageJson: {
            devDependencies: {
                '@nx/angular': '22.7.1',
                nx: '22.7.2',
            },
        },
        packages: {
            '@nx/angular@22.7.1': {},
            'nx@22.7.2': {},
        },
    });

    const result = runValidator(rootDir);

    assert.equal(result.status, 1);
    assert.match(
        result.stderr,
        /devDependencies\["@nx\/angular"\] must match nx@22\.7\.2, found "22\.7\.1"/
    );
});

test('rejects a direct official Nx peer dependency mismatch', async (t) => {
    const rootDir = await createFixture(t, {
        packageJson: {
            devDependencies: {
                nx: '22.7.2',
            },
            peerDependencies: {
                '@nx/angular': '22.7.1',
            },
        },
        packages: {
            '@nx/angular@22.7.2': {},
            'nx@22.7.2': {},
        },
    });

    const result = runValidator(rootDir);

    assert.equal(result.status, 1);
    assert.match(
        result.stderr,
        /peerDependencies\["@nx\/angular"\] must match nx@22\.7\.2, found "22\.7\.1"/
    );
});

test('rejects an extra direct Nx declaration mismatch', async (t) => {
    const rootDir = await createFixture(t, {
        packageJson: {
            devDependencies: {
                nx: '22.7.2',
            },
            optionalDependencies: {
                nx: '22.7.1',
            },
        },
        packages: {
            'nx@22.7.2': {},
        },
    });

    const result = runValidator(rootDir);

    assert.equal(result.status, 1);
    assert.match(
        result.stderr,
        /optionalDependencies\["nx"\] must match nx@22\.7\.2, found "22\.7\.1"/
    );
});

test('rejects a non-exact root Nx version', async (t) => {
    const rootDir = await createFixture(t, {
        packageJson: {
            devDependencies: {
                '@nx/angular': '^22.7.1',
                nx: '^22.7.1',
            },
        },
        packages: alignedPackages,
    });

    const result = runValidator(rootDir);

    assert.equal(result.status, 1);
    assert.match(
        result.stderr,
        /nx must use an exact semantic version, found "\^22\.7\.1"/
    );
});

test('rejects an extra resolved Nx version', async (t) => {
    const rootDir = await createFixture(t, {
        packageJson: {
            devDependencies: {
                '@nx/angular': '22.7.2',
                nx: '22.7.2',
            },
        },
        packages: {
            '@nx/angular@22.7.2': {},
            'nx@22.7.1': {},
            'nx@22.7.2': {},
        },
    });

    const result = runValidator(rootDir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /resolved nx@22\.7\.1 must match nx@22\.7\.2/);
});

test('rejects a transitive official Nx lockfile mismatch', async (t) => {
    const rootDir = await createFixture(t, {
        packageJson: {
            devDependencies: {
                '@nx/angular': '22.7.2',
                nx: '22.7.2',
            },
        },
        packages: {
            '@nx/angular@22.7.1': {},
            'nx@22.7.2': {},
        },
    });

    const result = runValidator(rootDir);

    assert.equal(result.status, 1);
    assert.match(
        result.stderr,
        /resolved @nx\/angular@22\.7\.1 must match nx@22\.7\.2/
    );
});

test('accepts matching Nx packages with pnpm peer-context suffixes', async (t) => {
    const rootDir = await createFixture(t, {
        packageJson: {
            devDependencies: {
                '@nx/angular': '23.2.1',
                nx: '23.2.1',
            },
        },
        packages: {
            '@nx/angular@23.2.1(e86c4a4fb085aa7a209327ce2b2f688a)': {},
            '@nx/devkit@23.2.1(nx@23.2.1(@swc/core@1.16.1))': {},
            'nx@23.2.1': {},
            'nx@23.2.1(@swc/core@1.16.1)': {},
        },
    });

    const result = runValidator(rootDir);

    assert.equal(result.status, 0, result.stderr);
    assert.match(
        result.stdout,
        /Nx dependency versions are synchronized at 23\.2\.1\./
    );
});

test('rejects a mismatched Nx version even when the lockfile key has peer context', async (t) => {
    const rootDir = await createFixture(t, {
        packageJson: {
            devDependencies: {
                '@nx/angular': '23.2.1',
                nx: '23.2.1',
            },
        },
        packages: {
            '@nx/angular@23.2.0(peer@1.0.0)': {},
            'nx@23.2.1': {},
        },
    });

    const result = runValidator(rootDir);

    assert.equal(result.status, 1);
    assert.match(
        result.stderr,
        /resolved @nx\/angular@23\.2\.0 must match nx@23\.2\.1/
    );
});

test('rejects malformed Nx lockfile versions instead of matching an embedded semver', async (t) => {
    const rootDir = await createFixture(t, {
        packageJson: {
            devDependencies: {
                '@nx/angular': '23.2.1',
                nx: '23.2.1',
            },
        },
        packages: {
            '@nx/angular@garbage23.2.1': {},
            'nx@garbage23.2.1': {},
        },
    });

    const result = runValidator(rootDir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /could not parse resolved package key "nx@garbage23\.2\.1"/);
    assert.match(result.stderr, /expected nx@23\.2\.1 to be resolved/);
});
