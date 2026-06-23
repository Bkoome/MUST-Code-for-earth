// Data client for the index views. In live mode (NEXT_PUBLIC_DATA_BASE set) it
// reads the static JSON contract from DATA_BASE; otherwise it adapts the mock
// FastAPI feed into the same contract shapes. Index components only see contract types.

import { DATA_BASE, LIVE_DATA } from 'app/config';
import type { CalendarIndex, RiskFields, RiskState, UnitRisk } from 'app/types/contract';
import { RISK_LABEL, RISK_RETURN_PERIODS, severityState } from 'app/types/contract';
import type { ExceedanceQuery } from 'app/types/exceedance';
import { fetchExceedanceCalendar, fetchExceedanceRegions } from './exceedance';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} unavailable (${res.status})`);
  return res.json() as Promise<T>;
}

export interface CalendarFeed {
  index: CalendarIndex;
  emdatDates: Set<string>; // mock only — live mode carries EM-DAT in {date}/emdat.geojson
}

/** index.json in live mode, or the mock calendar lifted into the same shape. */
export async function loadCalendarIndex(q: ExceedanceQuery): Promise<CalendarFeed> {
  if (LIVE_DATA) {
    const index = await getJson<CalendarIndex>(`${DATA_BASE}/index.json`);
    return { index, emdatDates: new Set() };
  }
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

// Lift a mock exceedance probability into a UnitRisk (p_red carries the severity
// so the choropleth ramp matches the original).
function mockUnit(shapeID: string, shapeName: string, p: number): UnitRisk {
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

/** {date}/region_risks.json (real) or the mock per-day regions lifted up. */
export async function loadRegionRisks(
  date: string,
  q: ExceedanceQuery,
): Promise<Record<string, UnitRisk>> {
  if (LIVE_DATA) {
    return getJson<Record<string, UnitRisk>>(`${DATA_BASE}/${date}/region_risks.json`);
  }
  const { regions } = await fetchExceedanceRegions(date, q);
  const out: Record<string, UnitRisk> = {};
  for (const r of regions) out[r.shapeID] = mockUnit(r.shapeID, r.shapeName, r.p);
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
