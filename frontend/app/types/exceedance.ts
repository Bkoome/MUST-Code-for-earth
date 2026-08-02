// Shapes for the titiler-xarray feed; the choropleth contract types are in ./contract.ts.
import type { AccumWindow, ReturnPeriod, DisasterType } from './pipeline';

// One forecast day in the calendar feed, per window + return period.
export interface CalendarDay {
  date: string; // YYYY-MM-DD
  p: number; // empirical exceedance probability in [0,1]
  members: number; // ensemble members over threshold (0..51)
  tp_max_mm?: number; // domain peak of the ensemble-mean accumulation
  emdat_match: boolean; // a verified EM-DAT flood was recorded near this day
}

// Summary builder progress from /xr/status.
export interface BuilderStatus {
  summarized: number;
  total: number;
  active_date: string | null;
  dates: string[]; // summarized dates
  queued: string[];
  failed: string[];
}

// Per-admin-1 exceedance for a selected day (drives the index choropleth).
export interface RegionExceedance {
  shapeID: string; // GID_1, matches icpac_adm1v3 properties.GID_1
  shapeName: string;
  p: number; // exceedance probability in [0,1]
}

// Ensemble signal within one recorded event's regions (peak over its span / on this run).
export interface EmdatSignal {
  p: number;
  date?: string;
  region: string | null;
}

// One recorded flood event overlapping the selected day.
export interface EmdatEvent {
  event_key: string;
  iso: string;
  country: string;
  deaths: number | null;
  affected: number | null;
  gids: string[]; // admin-1 gids resolved from the event's recorded locations
  start: string;
  end: string;
  signal?: EmdatSignal | null;
  signal_today?: EmdatSignal | null;
}

// EM-DAT match metadata for the selected day; top-level fields describe the deadliest event.
export interface EmdatMatch {
  event_key: string;
  affected: number | null;
  regions: number | null;
  gids?: string[];
  lead_h: number | null; // forecast signal lead time over recorded onset
  events?: EmdatEvent[]; // every overlapping event, deadliest first
  all_gids?: string[]; // union of resolved regions across events
  total_affected?: number | null;
  countries?: number;
}

export interface DayRegions {
  regions: RegionExceedance[];
  emdat: EmdatMatch | null;
}

// One ensemble member's cumulative rainfall trajectory at the forecast hotspot.
export interface EnsembleMember {
  label: string; // member id (e.g. 'ens_07', 'control')
  values: number[]; // cumulative mm over the full horizon, aligned to EnsembleTrajectory.leads
  over: boolean; // total at the event (window-end) clears the return-period threshold
}

// Per-member cumulative rainfall at the forecast hotspot, for the signal chapter chart.
export interface EnsembleTrajectory {
  date: string;
  window_h: number;
  rp: number;
  leads: number[]; // lead hours since init, ascending, across the full 0..168h horizon
  event_index: number; // index into leads of the selected window's verifying lead (the "event")
  threshold_mm: number; // rp threshold at the hotspot cell
  hotspot: { lat: number; lon: number };
  n_over: number; // members whose window-end total clears the threshold
  n_members: number;
  members: EnsembleMember[];
}

export interface ExceedanceQuery {
  hazard: DisasterType;
  window: AccumWindow;
  returnPeriod: ReturnPeriod;
}
