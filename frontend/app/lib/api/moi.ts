import { TILER_XR_BASE } from 'app/config';
import type { MoiDay, MoiFeed, MoiInfo } from 'app/types/moi';

// Module cache with in-flight dedupe, matching lib/api/catalogue.ts. The evaluation is
// a build artifact, so a hit never needs revalidating within a session.
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

// The backend answers 503 when the moi_* tables are not in the mounted database. That is
// a deployment state, not an error: callers get null and render nothing.
async function getOrNull<T>(path: string): Promise<T | null> {
  const response = await fetch(`${TILER_XR_BASE}${path}`);
  if (response.status === 503) return null;
  if (!response.ok) throw new Error(`Request failed: ${path} (${response.status})`);
  return response.json();
}

// Anticipation, attribution and the case ledger for one return period, plus the year's
// per-day verdicts for the calendar fill.
export function fetchMoi(returnPeriod: string, year: number): Promise<MoiFeed | null> {
  return cached(`moi|${returnPeriod}|${year}`, () =>
    getOrNull<MoiFeed>(`/xr/moi?rp=${returnPeriod}&year=${year}`),
  );
}

// Per-admin-1 verdicts for one day, for the map fill, the day card and the event ledger.
export function fetchMoiDay(date: string, returnPeriod: string): Promise<MoiDay | null> {
  return cached(`moi-day|${date}|${returnPeriod}`, () =>
    getOrNull<MoiDay>(`/xr/moi/${date}?rp=${returnPeriod}`),
  );
}

// Evaluation parameters and the impact-record coverage that bounds every count.
export function fetchMoiInfo(): Promise<MoiInfo | null> {
  return cached('moi-info', () => getOrNull<MoiInfo>('/xr/moi/info'));
}
