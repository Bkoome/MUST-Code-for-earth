import { TILER_XR_BASE } from 'app/config';
import type { CatalogueInfo, DayEvents } from 'app/types/catalogue';

// Module cache with in-flight dedupe, matching lib/api/exceedance.ts. Events are
// immutable for a given day, so a hit never needs revalidating within a session.
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

// The backend answers 503 when catalogue.sqlite is not mounted. That is a
// deployment state, not an error: callers get null and simply render nothing,
// the same way the ensemble chart is omitted when the store lacks a date.
async function getOrNull<T>(path: string): Promise<T | null> {
  const response = await fetch(`${TILER_XR_BASE}${path}`);
  if (response.status === 503) return null;
  if (!response.ok) throw new Error(`Request failed: ${path} (${response.status})`);
  return response.json();
}

// Recorded events covering one day, worst impact first.
export function fetchDayEvents(date: string): Promise<DayEvents | null> {
  return cached(`events|${date}`, () => getOrNull<DayEvents>(`/xr/events/${date}`));
}

// Catalogue provenance: sources, licensing, and the countries no feed reaches.
export function fetchCatalogueInfo(): Promise<CatalogueInfo | null> {
  return cached('catalogue', () => getOrNull<CatalogueInfo>('/xr/catalogue'));
}
