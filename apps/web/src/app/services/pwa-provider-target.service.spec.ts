import { HttpErrorResponse } from '@angular/common/http';
import {
    HttpClientTestingModule,
    HttpTestingController,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
    MAX_CACHED_PROVIDER_TARGETS,
    PwaProviderTargetService,
} from './pwa-provider-target.service';

describe('PwaProviderTargetService', () => {
    let http: HttpTestingController;
    let service: PwaProviderTargetService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [PwaProviderTargetService],
        });
        http = TestBed.inject(HttpTestingController);
        service = TestBed.inject(PwaProviderTargetService);
    });

    afterEach(() => http.verify());

    it('shares one in-flight registration for the same URL and backend', async () => {
        const url = 'https://provider.example/playlist.m3u';
        const first = service.withRegisteredTarget(
            url,
            '/api',
            async (id) => id
        );
        const second = service.withRegisteredTarget(
            url,
            '/api',
            async (id) => id
        );

        http.expectOne('/api/provider-targets').flush({
            targetId: 'shared-target',
        });

        await expect(Promise.all([first, second])).resolves.toEqual([
            'shared-target',
            'shared-target',
        ]);
        http.expectNone('/api/provider-targets');
    });

    it(
        're-registers and retries once when the backend no longer knows a target',
        async () => {
            const requestedIds: string[] = [];
            const pending = service.withRegisteredTarget(
                'https://provider.example',
                '/api',
                async (targetId) => {
                    requestedIds.push(targetId);
                    if (requestedIds.length === 1) {
                        throw new HttpErrorResponse({
                            status: 404,
                            statusText: 'Not Found',
                            error: {
                                message: 'Provider target not found',
                                status: 404,
                            },
                        });
                    }
                    return 'success';
                }
            );

            http.expectOne('/api/provider-targets').flush({
                targetId: 'same-id',
            });
            await new Promise((resolve) => setTimeout(resolve));

            http.expectOne('/api/provider-targets').flush({
                targetId: 'same-id',
            });

            await expect(pending).resolves.toBe('success');
            expect(requestedIds).toEqual(['same-id', 'same-id']);
        }
    );

    it('does not retry an upstream 404 with a different message', async () => {
        const pending = service.withRegisteredTarget(
            'https://provider.example',
            '/api',
            async () => {
                throw new HttpErrorResponse({
                    status: 404,
                    statusText: 'Not Found',
                    error: { message: 'Playlist not found', status: 404 },
                });
            }
        );

        http.expectOne('/api/provider-targets').flush({ targetId: 'target' });

        await expect(pending).rejects.toMatchObject({ status: 404 });
        http.expectNone('/api/provider-targets');
    });

    it('keeps registrations for different backend URLs separate', async () => {
        const url = 'https://provider.example';
        const first = service.withRegisteredTarget(
            url,
            '/api-a',
            async (id) => id
        );
        const second = service.withRegisteredTarget(
            url,
            '/api-b',
            async (id) => id
        );

        http.expectOne('/api-a/provider-targets').flush({
            targetId: 'target-a',
        });
        http.expectOne('/api-b/provider-targets').flush({
            targetId: 'target-b',
        });

        await expect(Promise.all([first, second])).resolves.toEqual([
            'target-a',
            'target-b',
        ]);
    });

    it('evicts old browser registrations from its bounded cache', async () => {
        for (let index = 0; index <= MAX_CACHED_PROVIDER_TARGETS; index++) {
            const url = `https://provider-${index}.example`;
            const pending = service.withRegisteredTarget(
                url,
                '/api',
                async (id) => id
            );

            http.expectOne('/api/provider-targets').flush({
                targetId: `target-${index}`,
            });
            await expect(pending).resolves.toBe(`target-${index}`);
        }

        const oldest = service.withRegisteredTarget(
            'https://provider-0.example',
            '/api',
            async (id) => id
        );
        http.expectOne('/api/provider-targets').flush({
            targetId: 'target-0-refreshed',
        });

        await expect(oldest).resolves.toBe('target-0-refreshed');
    });
});
