// Data client for the index views, backed by titiler-xarray. Index components
// only see contract types; exceedance rows are lifted into UnitRisk here.

import type { CalendarIndex, RiskState, UnitRisk } from 'app/types/contract';
import { RISK_LABEL, severityState } from 'app/types/contract';
import type { ExceedanceQuery, RegionExceedance } from 'app/types/exceedance';
import { fetchExceedanceCalendar, fetchExceedanceRegions, fetchRegionsBatch } from './exceedance';

export interface CalendarFeed {
  index: CalendarIndex;
  emdatDates: Set<string>;
}

/** Calendar rows lifted into the CalendarIndex contract shape. */
export async function loadCalendarIndex(q: ExceedanceQuery): Promise<CalendarFeed> {
  const days = await fetchExceedanceCalendar(q);
  const index: CalendarIndex = {};
  const emdatDates = new Set<string>();
  for (const d of days) {
    const state = severityState(d.p);
    index[d.date] = { worst_risk: state, risk_label: RISK_LABEL[state], n_units: d.members, p: d.p };
    if (d.emdat_match) emdatDates.add(d.date);
  }
  return { index, emdatDates };
}

function liftRegions(regions: RegionExceedance[]): Record<string, UnitRisk> {
  const out: Record<string, UnitRisk> = {};
  for (const r of regions) {
    const state = severityState(r.p);
    out[r.shapeID] = {
      name: r.shapeName,
      risk_state: state,
      risk_label: RISK_LABEL[state],
      p: r.p,
    };
  }
  return out;
}

/** Per-day region risks; 'pending' while the backend derives an unsummarized date. */
export async function loadRegionRisks(
  date: string,
  q: ExceedanceQuery,
): Promise<Record<string, UnitRisk> | 'pending'> {
  const result = await fetchExceedanceRegions(date, q);
  if (result === 'pending') return 'pending';
  return liftRegions(result.regions);
}

/** Region risks for every summarized date, from one batch request. */
export async function loadRegionRisksBatch(
  q: ExceedanceQuery,
): Promise<Record<string, Record<string, UnitRisk>>> {
  const batch = await fetchRegionsBatch(q);
  const out: Record<string, Record<string, UnitRisk>> = {};
  for (const [date, regions] of Object.entries(batch)) out[date] = liftRegions(regions);
  return out;
}

export type { RiskState };
