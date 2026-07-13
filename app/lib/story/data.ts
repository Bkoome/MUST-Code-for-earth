// Composes the per-forecast story inputs from the calendar and regions feeds.

import { fetchExceedanceCalendar, fetchExceedanceRegions } from 'app/lib/api/exceedance';
import type { EmdatMatch, ExceedanceQuery, RegionExceedance } from 'app/types/exceedance';

export const ENSEMBLE_SIZE = 51;

export interface StoryData {
  date: string;
  windowH: number;
  rp: number;
  p: number; // domain max exceedance probability
  members: number; // ensemble members over threshold
  tpMaxMm: number | null; // peak ensemble-mean accumulation
  regions: RegionExceedance[]; // ranked by p, descending
  topRegions: RegionExceedance[]; // up to 3 regions with signal
  emdat: EmdatMatch | null;
}

export function windowHours(window: string): number {
  return window === '7d' ? 168 : parseInt(window, 10);
}

export function rpYears(returnPeriod: string): number {
  return parseInt(returnPeriod, 10);
}

export async function fetchStoryData(
  date: string,
  q: ExceedanceQuery,
): Promise<StoryData | 'pending'> {
  const [days, day] = await Promise.all([
    fetchExceedanceCalendar(q),
    fetchExceedanceRegions(date, q),
  ]);
  if (day === 'pending') return 'pending';

  const row = days.find((d) => d.date === date);
  const ranked = [...day.regions].sort((a, b) => b.p - a.p);
  const p = row?.p ?? ranked[0]?.p ?? 0;
  return {
    date,
    windowH: windowHours(q.window),
    rp: rpYears(q.returnPeriod),
    p,
    members: row?.members ?? Math.round(p * ENSEMBLE_SIZE),
    tpMaxMm: row?.tp_max_mm ?? null,
    regions: ranked,
    topRegions: ranked.filter((r) => r.p > 0).slice(0, 3),
    emdat: day.emdat,
  };
}
