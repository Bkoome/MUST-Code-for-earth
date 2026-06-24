// Shapes for the mock FastAPI feed (backend/app.py), which uses a continuous probability
// `p`. The live data contract is in ./contract.ts; consumers move there when
// NEXT_PUBLIC_DATA_BASE is wired.
import type { AccumWindow, ReturnPeriod, DisasterType } from './pipeline';

// One forecast day in the calendar feed, per window + return period.
export interface CalendarDay {
  date: string; // YYYY-MM-DD
  p: number; // empirical exceedance probability in [0,1]
  members: number; // ensemble members over threshold (0..51)
  emdat_match: boolean; // a verified EM-DAT flood was recorded near this day
}

// Per-admin-1 exceedance for a selected day (drives the index choropleth).
export interface RegionExceedance {
  shapeID: string; // GID_1, matches icpac_adm1v3 properties.GID_1
  shapeName: string;
  p: number; // exceedance probability in [0,1]
}

// Optional EM-DAT match metadata for the selected day.
export interface EmdatMatch {
  event_key: string;
  affected: number | null;
  regions: number | null;
  lead_h: number | null; // forecast signal lead time over recorded onset
}

export interface DayRegions {
  regions: RegionExceedance[];
  emdat: EmdatMatch | null;
}

export interface ExceedanceQuery {
  hazard: DisasterType;
  window: AccumWindow;
  returnPeriod: ReturnPeriod;
}
