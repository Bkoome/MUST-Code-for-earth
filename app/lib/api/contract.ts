// Data client for the index views, backed by titiler-xarray. Index components
// only see contract types; exceedance rows are lifted into UnitRisk here.

import type { CalendarIndex, RiskFields, RiskState, UnitRisk } from 'app/types/contract';
import { RISK_LABEL, RISK_RETURN_PERIODS, severityState } from 'app/types/contract';
import type { ExceedanceQuery, RegionExceedance } from 'app/types/exceedance';
import {
  fetchExceedanceCalendar,
  fetchExceedanceRegions,
  fetchRegionsBatch,
} from './exceedance';

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
    index[d.date] = { worst_risk: state, risk_label: RISK_LABEL[state], n_units: d.members };
    if (d.emdat_match) emdatDates.add(d.date);
  }
  return { index, emdatDates };
}

// Lift an exceedance probability into a UnitRisk (p_red carries the severity
// so the choropleth ramp reads it directly).
function unitFromExceedance(shapeID: string, shapeName: string, p: number): UnitRisk {
  const state = severityState(p);
  return {
    pcode: shapeID,
    name: shapeName,
    country: '',
    risk_state: state,
    risk_label: RISK_LABEL[state],
    p_green: Math.max(0, 1 - p),
    p_yellow: 0,
    p_orange: 0,
    p_red: p,
  };
}

function liftRegions(regions: RegionExceedance[]): Record<string, UnitRisk> {
  const out: Record<string, UnitRisk> = {};
  for (const r of regions) out[r.shapeID] = unitFromExceedance(r.shapeID, r.shapeName, r.p);
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

// Map the UI's return-period control ('5yr') to the risk_by_rp key ('5'). Only
// 2yr + 5yr carry a risk_state; other RPs fall back to the unit's top-level fields.
export function rpKey(returnPeriod: string): string | null {
  const years = returnPeriod.replace('yr', '');
  return (RISK_RETURN_PERIODS as readonly string[]).includes(years) ? years : null;
}

/** Resolve a unit's risk fields for the selected return period. */
export function riskForRp(unit: UnitRisk, returnPeriod: string): RiskFields {
  const key = rpKey(returnPeriod);
  return (key && unit.risk_by_rp?.[key]) || unit;
}

export type { RiskState };
