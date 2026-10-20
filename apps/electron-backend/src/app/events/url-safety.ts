import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const PRIVATE_NETWORK_URLS_ENV = 'IPTVNATOR_ALLOW_PRIVATE_NETWORK_URLS';

/**
 * Raised when a renderer-supplied remote URL is rejected by the SSRF guard.
 */
export class UnsafeUrlError extends Error {
    readonly status: number;

    constructor(message: string, status = 400) {
        super(message);
        this.name = 'UnsafeUrlError';
        this.status = status;
    }
}

export interface RemoteUrlPolicy {
    /** When true, private/reserved targets are permitted (default false). */
    allowPrivateNetworks?: boolean;
    /**
     * When false, allowPrivateNetworks only applies to the initially validated
     * origin; cross-origin redirects must still resolve to public addresses.
     */
    allowPrivateNetworkRedirects?: boolean;
    /**
     * When true together with allowPrivateNetworks, hostnames are still resolved
     * for socket pinning. Private/reserved resolved addresses are accepted.
     */
    pinAllowedPrivateNetworkHosts?: boolean;
    /** Injectable DNS resolver. Defaults to `dns.lookup`; overridable in tests. */
    resolveHostname?: (hostname: string) => Promise<readonly string[]>;
}

export interface ValidatedRemoteUrl {
    /** Parsed URL, retaining the original hostname for TLS SNI and Host. */
    url: URL;
    /** Validated addresses that socket-level DNS lookup must be pinned to. */
    addresses?: readonly string[];
}

function isTruthyEnvironmentOptIn(value: string | undefined): boolean {
    const normalized = value?.trim().toLowerCase();
    return normalized === '1' || normalized === 'true';
}

export function isPrivateNetworkUrlAccessAllowed(): boolean {
    return isTruthyEnvironmentOptIn(process.env[PRIVATE_NETWORK_URLS_ENV]);
}

function normalizeHostname(hostname: string): string {
    let host = hostname.trim().toLowerCase();
    if (host.startsWith('[') && host.endsWith(']')) {
        host = host.slice(1, -1);
    }
    return host;
}

export function isLocalHostname(hostname: string): boolean {
    // DNS absolute names retain their trailing root dot in URL.hostname.
    // Normalize it so localhost aliases cannot bypass the pre-resolution guard.
    const normalized = normalizeHostname(hostname).replace(/\.+$/, '');
    return normalized === 'localhost' || normalized.endsWith('.localhost');
}

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 3],
] as const) {
    blockedIpv4.addSubnet(network, prefix, 'ipv4');
}

export function isPrivateOrReservedIpv4(address: string): boolean {
    return isIP(address) !== 4 || blockedIpv4.check(address, 'ipv4');
}

const mappedIpv4 = new BlockList();
mappedIpv4.addSubnet('::ffff:0:0', 96, 'ipv6');

const globallyRoutableIpv6 = new BlockList();
globallyRoutableIpv6.addSubnet('2000::', 3, 'ipv6');

const reservedIpv6 = new BlockList();
for (const [network, prefix] of [
    ['2001::', 23], // Protocol assignments, including Teredo and benchmarking.
    ['2001:db8::', 32], // Documentation.
    ['2002::', 16], // Deprecated 6to4 transition mechanism.
    ['3fff::', 20], // Documentation.
] as const) {
    reservedIpv6.addSubnet(network, prefix, 'ipv6');
}

export function isPrivateOrReservedIpv6(address: string): boolean {
    const normalized = address.toLowerCase();
    if (isIP(normalized) !== 6) return true;

    // IPv4-mapped IPv6 addresses inherit the IPv4 range policy.
    if (mappedIpv4.check(normalized, 'ipv6')) {
        return blockedIpv4.check(normalized, 'ipv6');
    }

    // Accept only global-unicast space, then exclude special-purpose blocks.
    // This also rejects IPv4-compatible ::/96, multicast, unspecified and
    // link-local addresses that are not globally routable.
    return (
        !globallyRoutableIpv6.check(normalized, 'ipv6') ||
        reservedIpv6.check(normalized, 'ipv6')
    );
}

export function isPrivateOrReservedIp(address: string): boolean {
    const version = isIP(address);
    if (version === 4) {
        return isPrivateOrReservedIpv4(address);
    }
    if (version === 6) {
        return isPrivateOrReservedIpv6(address);
    }
    return false;
}

async function defaultResolveHostname(
    hostname: string
): Promise<readonly string[]> {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
}

/**
 * Validates a renderer-supplied remote URL before the Electron main process
 * fetches it, preventing SSRF to loopback / private / reserved network
 * targets (e.g. `http://127.0.0.1`, `http://169.254.169.254` metadata).
 *
 * Returns the parsed {@link URL} when allowed, otherwise throws
 * {@link UnsafeUrlError}.
 */
export async function validateRemoteUrl(
    rawUrl: string,
    policy: RemoteUrlPolicy = {}
): Promise<ValidatedRemoteUrl> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new UnsafeUrlError('Invalid URL');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new UnsafeUrlError('Only http and https URLs are supported');
    }

    if (url.username || url.password) {
        throw new UnsafeUrlError('URL credentials are not supported');
    }

    const hostname = normalizeHostname(url.hostname);
    if (policy.allowPrivateNetworks) {
        if (!policy.pinAllowedPrivateNetworkHosts) {
            return { url };
        }

        if (isIP(hostname) !== 0) {
            return { url, addresses: [hostname] };
        }

        const resolveHostname =
            policy.resolveHostname ?? defaultResolveHostname;
        let addresses: readonly string[];
        try {
            addresses = await resolveHostname(hostname);
        } catch {
            throw new UnsafeUrlError('URL host could not be resolved');
        }

        if (
            addresses.length === 0 ||
            addresses.some((address) => isIP(normalizeHostname(address)) === 0)
        ) {
            throw new UnsafeUrlError('URL host could not be resolved');
        }

        return {
            url,
            addresses: addresses.map((address) => normalizeHostname(address)),
        };
    }

    if (isLocalHostname(hostname) || isPrivateOrReservedIp(hostname)) {
        throw new UnsafeUrlError(
            'URL points to a private or local network address'
        );
    }

    if (isIP(hostname) !== 0) {
        return { url, addresses: [hostname] };
    }

    {
        const resolveHostname =
            policy.resolveHostname ?? defaultResolveHostname;
        let addresses: readonly string[];
        try {
            addresses = await resolveHostname(hostname);
        } catch {
            throw new UnsafeUrlError('URL host could not be resolved');
        }

        if (
            addresses.length === 0 ||
            addresses.some((address) => {
                const normalizedAddress = normalizeHostname(address);
                return (
                    isIP(normalizedAddress) === 0 ||
                    isPrivateOrReservedIp(normalizedAddress)
                );
            })
        ) {
            throw new UnsafeUrlError(
                'URL points to a private or local network address'
            );
        }

        return {
            url,
            addresses: addresses.map((address) => normalizeHostname(address)),
        };
    }
}

/**
 * Validates a URL and returns its parsed representation.
 */
export async function assertRemoteUrlAllowed(
    rawUrl: string,
    policy: RemoteUrlPolicy = {}
): Promise<URL> {
    return (await validateRemoteUrl(rawUrl, policy)).url;
}
