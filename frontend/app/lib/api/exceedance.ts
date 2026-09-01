import { TILER_XR_BASE } from 'app/config';
import type {
  BuilderStatus,
  CalendarDay,
  DayRegions,
  EnsembleTrajectory,
  ExceedanceQuery,
  RegionExceedance,
} from 'app/types/exceedance';

// Module cache with in-flight dedupe; concurrent callers share one request.
const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (cache.has(key)) return Promise.resolve(cache.get(key) as T);
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const job = load()
    .then((value) => {
      cache.set(key, value);
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

// Calendar and batch payloads grow while the builder runs; drop them on progress.
export function clearArchiveCache(): void {
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith('calendar|') || key.startsWith('batch|')) cache.delete(key);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${TILER_XR_BASE}${path}`);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${path}`);
  }
  return response.json();
}

// Daily exceedance rows for the current window + return period.
export function fetchExceedanceCalendar(q: ExceedanceQuery): Promise<CalendarDay[]> {
  return cached(`calendar|${q.window}|${q.returnPeriod}`, async () => {
    const payload = await getJson<{ data?: CalendarDay[] }>(
      `/xr/calendar?window=${q.window}&rp=${q.returnPeriod}`,
    );
    return payload.data ?? [];
  });
}

// Admin-1 breakdowns for every summarized date in one request.
export function fetchRegionsBatch(q: ExceedanceQuery): Promise<Record<string, RegionExceedance[]>> {
  return cached(`batch|${q.window}|${q.returnPeriod}`, async () => {
    const payload = await getJson<{ data?: Record<string, RegionExceedance[]> }>(
      `/xr/regions-batch?window=${q.window}&rp=${q.returnPeriod}`,
    );
    return payload.data ?? {};
  });
}

// Admin-1 breakdown for one day; 'pending' while the backend derives it.
export async function fetchExceedanceRegions(
  date: string,
  q: ExceedanceQuery,
): Promise<DayRegions | 'pending'> {
  const key = `regions|${q.window}|${q.returnPeriod}|${date}`;
  if (cache.has(key)) return cache.get(key) as DayRegions;
  const running = inflight.get(key);
  if (running) return running as Promise<DayRegions | 'pending'>;
  const job = (async () => {
    const response = await fetch(
      `${TILER_XR_BASE}/xr/regions/${date}?window=${q.window}&rp=${q.returnPeriod}`,
    );
    if (response.status === 202) return 'pending' as const;
    if (!response.ok) throw new Error(`Regions request failed for ${date} (${response.status})`);
    const payload = (await response.json()) as Partial<DayRegions>;
    const result: DayRegions = { regions: payload.regions ?? [], emdat: payload.emdat ?? null };
    cache.set(key, result);
    return result;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

// Per-admin-1 observed peak rainfall (mm) for a date + window; empty when obs is off.
export function fetchObservedRegions(
  date: string,
  window: string,
): Promise<{ available: boolean; regions: Record<string, number> }> {
  return cached(`observed|${window}|${date}`, async () => {
    const payload = await getJson<{ available?: boolean; regions?: Record<string, number> }>(
      `/xr/observed/${date}?window=${window}`,
    );
    return { available: payload.available ?? false, regions: payload.regions ?? {} };
  });
}

// Per-member cumulative rainfall at the forecast hotspot; null while pending or when
// exceedance is disabled, so the signal chapter simply omits the chart.
export async function fetchEnsemble(
  date: string,
  q: ExceedanceQuery,
): Promise<EnsembleTrajectory | null> {
  const key = `ensemble|${q.window}|${q.returnPeriod}|${date}`;
  if (cache.has(key)) return cache.get(key) as EnsembleTrajectory;
  const running = inflight.get(key);
  if (running) return running as Promise<EnsembleTrajectory | null>;
  const job = (async () => {
    const response = await fetch(
      `${TILER_XR_BASE}/xr/ensemble/${date}?window=${q.window}&rp=${q.returnPeriod}`,
    );
    // 202 carries a {status:'pending'} body, not a trajectory, and `ok` is true
    // for it — so test the code explicitly or the chart renders from the stub.
    if (response.status === 202 || !response.ok) return null;
    const payload = (await response.json()) as EnsembleTrajectory;
    cache.set(key, payload);
    return payload;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

// Summary builder progress; never cached, drives the progress affordance.
export async function fetchStatus(): Promise<BuilderStatus> {
  return getJson<BuilderStatus>('/xr/status');
}
