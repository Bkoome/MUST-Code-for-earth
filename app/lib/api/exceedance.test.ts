import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fresh module per test so the module-level cache starts empty.
async function loadModule() {
  vi.resetModules();
  return import('./exceedance');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const QUERY = { hazard: 'flood', window: '24h', returnPeriod: '10yr' } as const;

describe('exceedance api cache', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serves repeat calendar calls from the cache', async () => {
    const api = await loadModule();
    const mock = fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue(jsonResponse({ data: [{ date: '2026-03-04', p: 0.2, members: 10, emdat_match: false }] }));

    const first = await api.fetchExceedanceCalendar(QUERY);
    const second = await api.fetchExceedanceCalendar(QUERY);
    expect(first).toEqual(second);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent in-flight requests', async () => {
    const api = await loadModule();
    const mock = fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockImplementation(async () => jsonResponse({ data: {} }));

    await Promise.all([api.fetchRegionsBatch(QUERY), api.fetchRegionsBatch(QUERY)]);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('keys the cache by window and return period', async () => {
    const api = await loadModule();
    const mock = fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockImplementation(async () => jsonResponse({ data: [] }));

    await api.fetchExceedanceCalendar(QUERY);
    await api.fetchExceedanceCalendar({ ...QUERY, returnPeriod: '2yr' });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('returns pending on 202 and does not cache it', async () => {
    const api = await loadModule();
    const mock = fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce(jsonResponse({ status: 'pending' }, 202));
    mock.mockResolvedValueOnce(jsonResponse({ regions: [], emdat: null }));

    expect(await api.fetchExceedanceRegions('2026-03-05', QUERY)).toBe('pending');
    const second = await api.fetchExceedanceRegions('2026-03-05', QUERY);
    expect(second).toEqual({ regions: [], emdat: null });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('clears archive keys but keeps per-day regions', async () => {
    const api = await loadModule();
    const mock = fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockImplementation(async () => jsonResponse({ data: [], regions: [], emdat: null }));

    await api.fetchExceedanceCalendar(QUERY);
    await api.fetchExceedanceRegions('2026-03-04', QUERY);
    api.clearArchiveCache();
    await api.fetchExceedanceCalendar(QUERY);
    await api.fetchExceedanceRegions('2026-03-04', QUERY);
    expect(mock).toHaveBeenCalledTimes(3); // calendar refetched, regions still cached
  });
});
