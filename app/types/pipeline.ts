// Hazard type: flood only.
export type DisasterType = 'flood';

// Two-tier app model: a calendar-map index and a per-day scrollytelling storymap.
export type AppView = 'index' | 'story';

// Accumulation windows: 3h → 7 days.
export type AccumWindow = '3h' | '6h' | '12h' | '24h' | '48h' | '72h' | '7d';
export const ACCUM_WINDOWS: AccumWindow[] = ['3h', '6h', '12h', '24h', '48h', '72h', '7d'];

// Return-period thresholds: 2 → 100 years.
export type ReturnPeriod = '2yr' | '5yr' | '10yr' | '20yr' | '40yr' | '100yr';
export const RETURN_PERIODS: ReturnPeriod[] = ['2yr', '5yr', '10yr', '20yr', '40yr', '100yr'];

// Calendar archive span (forecast days available).
export const CAL_YEARS = [2023, 2024, 2025] as const;

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
