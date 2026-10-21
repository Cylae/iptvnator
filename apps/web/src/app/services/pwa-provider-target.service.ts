import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

interface ProviderTargetRegistration {
    readonly targetId: string;
}

/** Bounds the browser-side registration cache independently of the backend. */
export const MAX_CACHED_PROVIDER_TARGETS = 256;

@Injectable({
    providedIn: 'root',
})
export class PwaProviderTargetService {
    private readonly http = inject(HttpClient);
    private readonly registrations = new Map<string, Promise<string>>();

    /**
     * Runs a provider request with a registered target. If the backend reports
     * that the target has disappeared (for example after a restart or LRU
     * eviction), register the URL again and retry exactly once. Upstream 404s
     * are deliberately not retried.
     */
    async withRegisteredTarget<T>(
        url: string,
        backendUrl: string,
        request: (targetId: string) => Promise<T>
    ): Promise<T> {
        const cacheKey = this.cacheKey(url, backendUrl);
        const registration = this.getTargetId(url, backendUrl, cacheKey);
        const targetId = await registration;

        try {
            return await request(targetId);
        } catch (error) {
            if (!this.isMissingProviderTargetError(error)) {
                throw error;
            }

            // Compare promise identity, not targetId: IDs are deterministic, so
            // a concurrent refresh may legitimately return the same ID.
            if (this.registrations.get(cacheKey) === registration) {
                this.registrations.delete(cacheKey);
            }

            return request(await this.getTargetId(url, backendUrl, cacheKey));
        }
    }

    private getTargetId(
        url: string,
        backendUrl: string,
        cacheKey: string
    ): Promise<string> {
        const cached = this.registrations.get(cacheKey);
        if (cached) {
            this.registrations.delete(cacheKey);
            this.registrations.set(cacheKey, cached);
            return cached;
        }

        let registration: Promise<string>;
        registration = firstValueFrom(
            this.http.post<ProviderTargetRegistration>(
                `${backendUrl}/provider-targets`,
                { url }
            )
        )
            .then((response) => response.targetId)
            .catch((error) => {
                // An older failed request must not delete a newer registration.
                if (this.registrations.get(cacheKey) === registration) {
                    this.registrations.delete(cacheKey);
                }
                throw error;
            });

        this.registrations.set(cacheKey, registration);
        while (this.registrations.size > MAX_CACHED_PROVIDER_TARGETS) {
            const leastRecentlyUsed = this.registrations.keys().next().value;
            if (leastRecentlyUsed === undefined) {
                break;
            }
            this.registrations.delete(leastRecentlyUsed);
        }

        return registration;
    }

    private cacheKey(url: string, backendUrl: string): string {
        return JSON.stringify([backendUrl, url]);
    }

    private isMissingProviderTargetError(error: unknown): boolean {
        if (!error || typeof error !== 'object') {
            return false;
        }

        const candidate = error as {
            status?: unknown;
            message?: unknown;
            error?: unknown;
        };
        if (candidate.status !== 404) {
            return false;
        }

        if (candidate.message === 'Provider target not found') {
            return true;
        }

        const body = candidate.error;
        if (!body || typeof body !== 'object') {
            return false;
        }
        const value = body as { message?: unknown; status?: unknown };
        return (
            value.message === 'Provider target not found' &&
            value.status === 404
        );
    }
}
