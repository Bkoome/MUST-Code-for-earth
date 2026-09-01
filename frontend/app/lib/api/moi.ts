import { TILER_XR_BASE } from 'app/config';
import type { MoiDay, MoiInfo, MoiYear } from 'app/types/moi';

// Module cache with in-flight dedupe, matching lib/api/catalogue.ts. A verdict is
// a property of a finished day, so a hit never needs revalidating in a session.
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

// 503 means the moi_* tables are not in the mounted catalogue — a deployment
// state, not an error. Callers render nothing, exactly as the event ledger does.
async function getOrNull<T>(path: string): Promise<T | null> {
  const response = await fetch(`${TILER_XR_BASE}${path}`);
  if (response.status === 503) return null;
  if (!response.ok) throw new Error(`Request failed: ${path} (${response.status})`);
  return response.json();
}

// The verdicts for one day, ranked worst-first by the backend.
export function fetchDayVerdicts(date: string, rp: string): Promise<MoiDay | null> {
  return cached(`moi-day|${date}|${rp}`, () => getOrNull<MoiDay>(`/xr/moi/${date}?rp=${rp}`));
}

// A year of day-level verdicts, read only for the calendar's recorded-flood dots.
export function fetchYearVerdicts(year: number, rp: string): Promise<MoiYear | null> {
  return cached(`moi-year|${year}|${rp}`, () =>
    getOrNull<MoiYear>(`/xr/moi?rp=${rp}&year=${year}`),
  );
}

// Parameters and impact-record coverage, so the caveats quote the build.
export function fetchMoiInfo(): Promise<MoiInfo | null> {
  return cached('moi-info', () => getOrNull<MoiInfo>('/xr/moi/info'));
}
