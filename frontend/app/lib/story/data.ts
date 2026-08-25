// Composes the per-forecast story inputs from the calendar and regions feeds.

import {
  fetchExceedanceCalendar,
  fetchExceedanceRegions,
  fetchObservedRegions,
} from 'app/lib/api/exceedance';
import { fetchDayEvents } from 'app/lib/api/catalogue';
import type { DayEvents } from 'app/types/catalogue';
import type {
  EmdatMatch,
  EnsembleTrajectory,
  ExceedanceQuery,
  RegionExceedance,
} from 'app/types/exceedance';

export const ENSEMBLE_SIZE = 51;

export interface StoryData {
  date: string;
  windowH: number;
  rp: number;
  p: number; // domain max exceedance probability
  members: number; // ensemble members over threshold
  tpMaxMm: number | null; // peak ensemble-mean accumulation
  obsTopMm: number | null; // observed peak mm over the strongest-signal admin-1 region
  obsRegions: Record<string, number> | null; // gid -> observed peak mm, null when obs is off
  regions: RegionExceedance[]; // ranked by p, descending
  topRegions: RegionExceedance[]; // up to 3 regions with signal
  emdat: EmdatMatch | null;
  // Recorded events from the multi-source catalogue. It carries EM-DAT as one of
  // its sources, so it supersedes `emdat` for the impact act and reaches days the
  // EM-DAT-only feed never covered.
  catalogue: DayEvents | null;
  ensemble: EnsembleTrajectory | null; // per-member trajectories for the signal chart
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
  const [days, day, observed, catalogue] = await Promise.all([
    fetchExceedanceCalendar(q),
    fetchExceedanceRegions(date, q),
    fetchObservedRegions(date, q.window),
    // A catalogue that is absent or disabled must not cost the story its other
    // acts, so this one resolves to null rather than rejecting.
    fetchDayEvents(date).catch(() => null),
  ]);
  if (day === 'pending') return 'pending';

  const row = days.find((d) => d.date === date);
  const ranked = [...day.regions].sort((a, b) => b.p - a.p);
  const p = row?.p ?? ranked[0]?.p ?? 0;
  const topRegions = ranked.filter((r) => r.p > 0).slice(0, 3);
  // Observed rainfall over the flagged region so the stat tracks the strongest signal.
  const topGid = topRegions[0]?.shapeID;
  const obsRegions = observed.available ? observed.regions : null;
  const obsTopMm = obsRegions && topGid ? (obsRegions[topGid] ?? null) : null;
  return {
    date,
    windowH: windowHours(q.window),
    rp: rpYears(q.returnPeriod),
    p,
    members: row?.members ?? Math.round(p * ENSEMBLE_SIZE),
    tpMaxMm: row?.tp_max_mm ?? null,
    obsTopMm,
    obsRegions,
    regions: ranked,
    topRegions,
    emdat: day.emdat,
    catalogue: catalogue && catalogue.count > 0 ? catalogue : null,
    ensemble: null, // fetched separately (non-blocking) so a slow/failed chart never blocks the story
  };
}
