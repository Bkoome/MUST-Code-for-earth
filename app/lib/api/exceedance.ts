import { API_BASE_URL } from 'app/config';
import type { CalendarDay, DayRegions, ExceedanceQuery } from 'app/types/exceedance';

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { cache: 'no-store' });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${path}`);
  }
  return response.json();
}

function qs({ hazard, window, returnPeriod }: ExceedanceQuery): string {
  return `window=${window}&rp=${returnPeriod}&hazard=${hazard}`;
}

// ~1,000 forecast days of daily exceedance for the current window + return period.
export async function fetchExceedanceCalendar(q: ExceedanceQuery): Promise<CalendarDay[]> {
  const payload = await request<{ data?: CalendarDay[] }>(`/api/exceedance-calendar?${qs(q)}`);
  return payload.data ?? [];
}

// Admin-1 exceedance breakdown for one day (+ optional EM-DAT match).
export async function fetchExceedanceRegions(
  date: string,
  q: ExceedanceQuery,
): Promise<DayRegions> {
  const payload = await request<Partial<DayRegions>>(`/api/exceedance-regions/${date}?${qs(q)}`);
  return { regions: payload.regions ?? [], emdat: payload.emdat ?? null };
}
