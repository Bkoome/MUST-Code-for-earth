// Hazard type: flood only.
export type DisasterType = 'flood';

// Two-tier app model: a calendar-map index and a per-day scrollytelling storymap.
export type AppView = 'index' | 'story';

// Accumulation windows: 3h -> 7 days.
export type AccumWindow = '3h' | '6h' | '12h' | '24h' | '48h' | '72h' | '7d';
export const ACCUM_WINDOWS: AccumWindow[] = ['3h', '6h', '12h', '24h', '48h', '72h', '7d'];

// Return-period thresholds: 2 -> 100 years (values present in the CMORPH file).
export type ReturnPeriod = '2yr' | '5yr' | '10yr' | '20yr' | '50yr' | '100yr';
export const RETURN_PERIODS: ReturnPeriod[] = ['2yr', '5yr', '10yr', '20yr', '50yr', '100yr'];

// First year MUST covers. The archive is served from the Icechunk store via
// titiler-xarray.
export const ARCHIVE_START_YEAR = 2023;

/** Every year the calendar offers: the archive start through the current year. */
export function calendarYears(now: Date = new Date()): number[] {
  const end = Math.max(ARCHIVE_START_YEAR, now.getFullYear());
  return Array.from({ length: end - ARCHIVE_START_YEAR + 1 }, (_, i) => ARCHIVE_START_YEAR + i);
}

// Derived rather than listed, so the selector does not go stale each January.
export const CAL_YEARS = calendarYears();

export interface PipelineState {
  view: AppView;
  hazard: DisasterType; // flood only
  selectedDate?: string | null; // YYYY-MM-DD
  window: AccumWindow;
  returnPeriod: ReturnPeriod;
}

export const DEFAULT_PIPELINE_STATE: PipelineState = {
  view: 'index',
  hazard: 'flood',
  selectedDate: null,
  window: '24h',
  returnPeriod: '10yr',
};
