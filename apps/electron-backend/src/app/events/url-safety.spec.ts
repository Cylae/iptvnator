import {
    assertRemoteUrlAllowed,
    isPrivateOrReservedIp,
    isPrivateOrReservedIpv6,
    isPrivateNetworkUrlAccessAllowed,
    UnsafeUrlError,
    validateRemoteUrl,
} from './url-safety';

describe('url-safety', () => {
    describe('isPrivateOrReservedIpv6', () => {
        it.each(['', 'not-an-ip', '127.0.0.1'])(
            'treats invalid IPv6 classifier input %j as reserved',
            (address) => {
                expect(isPrivateOrReservedIpv6(address)).toBe(true);
            }
        );
    });

    describe('isPrivateOrReservedIp', () => {
        it.each([
            '0.0.0.0',
            '10.0.0.5',
            '100.64.0.1',
            '127.0.0.1',
            '169.254.169.254',
            '172.16.0.1',
            '192.0.0.1',
            '192.0.2.1',
            '192.88.99.1',
            '192.168.1.1',
            '198.18.0.1',
            '198.51.100.1',
            '203.0.113.1',
            '224.0.0.1',
            '255.255.255.255',
            '::',
            '::1',
            'fc00::1',
            'fd00::1',
            'fe80::1',
            'febf::1',
            'ff02::1',
            '::ffff:127.0.0.1',
            '::ffff:7f00:1',
            '::ffff:a00:1',
            '::ffff:c0a8:101',
            '0:0:0:0:0:ffff:a9fe:a9fe',
            '::7f00:1',
            '64:ff9b::a00:1',
            '2001::1',
            '2001:db8::1',
            '2002:7f00:1::',
            '2002:c0a8:101::1',
            '3fff::1',
        ])('flags %s as private/reserved', (ip) => {
            expect(isPrivateOrReservedIp(ip)).toBe(true);
        });

        it.each([
            '93.184.216.34',
            '8.8.8.8',
            '1.1.1.1',
            '192.0.1.1',
            '2001:4860:4860::8888',
            '2606:4700:4700::1111',
            '::ffff:808:808',
        ])(
            'allows public address %s',
            (ip) => {
                expect(isPrivateOrReservedIp(ip)).toBe(false);
            }
        );
    });

    describe('assertRemoteUrlAllowed', () => {
        const publicResolver = async () => ['93.184.216.34'];

        it('rejects non-http(s) protocols', async () => {
            await expect(
                assertRemoteUrlAllowed('file:///etc/passwd')
            ).rejects.toBeInstanceOf(UnsafeUrlError);
        });

        it('rejects embedded credentials', async () => {
            await expect(
                assertRemoteUrlAllowed('http://user:pass@example.com', {
                    resolveHostname: publicResolver,
                })
            ).rejects.toBeInstanceOf(UnsafeUrlError);
        });

        it('rejects loopback literal', async () => {
            await expect(
                assertRemoteUrlAllowed('http://127.0.0.1/admin')
            ).rejects.toBeInstanceOf(UnsafeUrlError);
        });

        it('rejects localhost hostname', async () => {
            await expect(
                assertRemoteUrlAllowed('http://localhost:8080')
            ).rejects.toBeInstanceOf(UnsafeUrlError);
        });

        it.each([
            'http://localhost./admin',
            'http://metadata.localhost./admin',
            'http://localhost../admin',
            'http://metadata.localhost../admin',
        ])(
            'rejects absolute localhost hostname %s before DNS resolution',
            async (rawUrl) => {
                const resolveHostname = jest.fn(async () => ['93.184.216.34']);

                await expect(
                    assertRemoteUrlAllowed(rawUrl, { resolveHostname })
                ).rejects.toBeInstanceOf(UnsafeUrlError);
                expect(resolveHostname).not.toHaveBeenCalled();
            }
        );

        it('rejects the cloud metadata address', async () => {
            await expect(
                assertRemoteUrlAllowed(
                    'http://169.254.169.254/latest/meta-data'
                )
            ).rejects.toBeInstanceOf(UnsafeUrlError);
        });

        it('rejects IPv6 documentation addresses', async () => {
            await expect(
                assertRemoteUrlAllowed('https://[2001:db8::1]/playlist.m3u')
            ).rejects.toBeInstanceOf(UnsafeUrlError);
        });

        it('rejects IPv4-compatible IPv6 loopback literals', async () => {
            await expect(
                assertRemoteUrlAllowed('http://[::127.0.0.1]/admin')
            ).rejects.toBeInstanceOf(UnsafeUrlError);
        });

        it('rejects hex-form IPv4-mapped IPv6 loopback literals', async () => {
            await expect(
                assertRemoteUrlAllowed('http://[::ffff:7f00:1]/admin')
            ).rejects.toBeInstanceOf(UnsafeUrlError);
        });

        it('rejects a hostname that resolves to a private IP', async () => {
            await expect(
                assertRemoteUrlAllowed('http://rebind.example', {
                    resolveHostname: async () => ['10.0.0.1'],
                })
            ).rejects.toBeInstanceOf(UnsafeUrlError);
        });

        it.each([
            { label: 'empty answer', addresses: [] },
            {
                label: 'IPv4 public plus IPv4 private',
                addresses: ['93.184.216.34', '127.0.0.1'],
            },
            {
                label: 'IPv4 public plus IPv6 reserved',
                addresses: ['93.184.216.34', '2001:db8::1'],
            },
            {
                label: 'malformed DNS answer',
                addresses: ['93.184.216.34', 'not-an-ip-address'],
            },
        ])(
            'rejects $label',
            async ({ addresses }) => {
                await expect(
                    assertRemoteUrlAllowed('https://mixed.example', {
                        resolveHostname: async () => addresses,
                    })
                ).rejects.toBeInstanceOf(UnsafeUrlError);
            }
        );

        it('allows a public URL', async () => {
            const target = await validateRemoteUrl(
                'https://example.com/playlist.m3u',
                { resolveHostname: publicResolver }
            );
            expect(target.url.hostname).toBe('example.com');
            expect(target.addresses).toEqual(['93.184.216.34']);
        });

        it('honors the allowPrivateNetworks override', async () => {
            const url = await assertRemoteUrlAllowed('http://127.0.0.1/probe', {
                allowPrivateNetworks: true,
            });
            expect(url.hostname).toBe('127.0.0.1');
        });
    });

    describe('isPrivateNetworkUrlAccessAllowed', () => {
        const originalValue = process.env.IPTVNATOR_ALLOW_PRIVATE_NETWORK_URLS;

        afterEach(() => {
            if (originalValue === undefined) {
                delete process.env.IPTVNATOR_ALLOW_PRIVATE_NETWORK_URLS;
            } else {
                process.env.IPTVNATOR_ALLOW_PRIVATE_NETWORK_URLS =
                    originalValue;
            }
        });

        it('requires an explicit environment opt-in', () => {
            delete process.env.IPTVNATOR_ALLOW_PRIVATE_NETWORK_URLS;
            expect(isPrivateNetworkUrlAccessAllowed()).toBe(false);

            process.env.IPTVNATOR_ALLOW_PRIVATE_NETWORK_URLS = ' TRUE ';
            expect(isPrivateNetworkUrlAccessAllowed()).toBe(true);
        });
    });
});
