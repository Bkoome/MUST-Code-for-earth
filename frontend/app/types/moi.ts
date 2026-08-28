// Missed-opportunity evaluation from the backend moi_* tables. Mirrors app/moi.py;
// see backend/tools/moi/README.md for what each population may and may not claim.

export type MoiVerdict =
  | 'missed_opportunity'
  | 'late_warning'
  | 'forecast_miss'
  | 'outside_rainfall_model'
  | 'no_recorded_impact'
  | 'no_impact_data';

// Worst-known first: also the ranking a day's cell takes when its units disagree.
export const VERDICT_ORDER: MoiVerdict[] = [
  'missed_opportunity',
  'late_warning',
  'forecast_miss',
  'outside_rainfall_model',
  'no_recorded_impact',
  'no_impact_data',
];

export const VERDICT_LABEL: Record<MoiVerdict, string> = {
  missed_opportunity: 'Missed opportunity',
  late_warning: 'Late warning',
  forecast_miss: 'Not anticipated',
  outside_rainfall_model: 'Outside the rainfall model',
  no_recorded_impact: 'No recorded impact',
  no_impact_data: 'No impact record',
};

export const VERDICT_NOTE: Record<MoiVerdict, string> = {
  missed_opportunity:
    'A qualifying signal existed at least 24 h ahead, and the impact happened anyway.',
  late_warning: 'The signal only appeared on the day itself — too late to act on.',
  forecast_miss:
    'An unusual rainfall event was observed and recorded as damaging, with no qualifying signal at any lead.',
  outside_rainfall_model:
    'A flood was recorded with no observed rainfall extreme in the unit. A hazard MUST does not forecast, not a failure of it.',
  no_recorded_impact:
    'An unusual rainfall event was observed inside a country whose loss record covers this day, and nothing was recorded.',
  no_impact_data:
    'No admin-1 loss record reaches this country on this day, so nothing here can be scored.',
};

// Deliberately not the YlOrRd exceedance ramp: a verdict is a different kind of claim
// from a probability, and reading one off the other's scale is the whole error this
// panel exists to avoid. no_impact_data has no colour — it is drawn as a hatch.
export const VERDICT_COLOR: Record<MoiVerdict, string> = {
  missed_opportunity: '#9d174d',
  late_warning: '#d97706',
  forecast_miss: '#14424f',
  outside_rainfall_model: '#93a7ae',
  no_recorded_impact: '#35b7d1',
  no_impact_data: '#e8eef0',
};

// Shared <defs> id for the hatch both the calendar and the map fill unscorable units with.
export const HATCH_ID = 'moi-hatch';

export interface AnticipationRow {
  rp: number;
  hits: number;
  misses: number;
  false_alarms: number;
  hit_rate: number | null;
  far: number | null;
}

export interface Anticipation {
  population: number;
  lead_hours: number;
  obs_rp: number;
  strong_p: number;
  rp: number | null;
  at_rp: AnticipationRow | null;
  by_rp: AnticipationRow[];
}

export interface TierRow {
  tier: string;
  events: number;
  mean_obs_mm: number | null;
  deaths: number;
  affected: number;
}

export interface Attribution {
  events: number;
  tiers: TierRow[];
  impact_source: string | null;
  join_tolerance_days: number;
  max_scored_span_days: number;
}

export interface MoiCase {
  event_id: number;
  gid: string;
  region: string;
  iso3: string;
  rp: number;
  verdict: MoiVerdict;
  p_best: number | null;
  p_lead0: number | null;
  best_lead_h: number | null;
  // 'none_available' on every row: MUST holds no warning registry, so the
  // documented-warning clause of the definition is unverified, not satisfied.
  warning_record: string;
  span_days: number;
  obs_mm: number | null;
  obs_rp: number | null;
  source: string;
  event_key: string | null;
  place: string | null;
  start: string;
  end: string;
  deaths: number | null;
  affected: number | null;
}

export interface CaseCount {
  rp: number;
  missed_opportunity: number;
  late_warning: number;
  forecast_miss: number;
}

export interface DayVerdict {
  verdict: MoiVerdict;
  units: number;
  counts: Partial<Record<MoiVerdict, number>>;
}

export interface MoiFeed {
  rp: number;
  year: number | null;
  anticipation: Anticipation;
  anticipation_year: Anticipation | null;
  attribution: Attribution;
  cases: MoiCase[];
  case_counts: CaseCount[];
  days: Record<string, DayVerdict>;
}

export interface MoiUnitEvent {
  event_id: number;
  source: string;
  event_key: string | null;
  start: string;
  end: string;
  span_days: number;
  deaths: number | null;
  affected: number | null;
  obs_mm: number | null;
  tier: string;
  warning_record: string;
}

export interface MoiUnit {
  gid: string;
  name: string | null;
  iso3: string | null;
  verdict: MoiVerdict;
  obs_mm: number | null;
  obs_rp: number | null;
  anticipated: boolean;
  p_best: number | null;
  lead_h: number | null;
  event: MoiUnitEvent | null;
}

export interface MoiDay {
  date: string;
  rp: number;
  count: number;
  data: MoiUnit[];
}

export interface MoiCoverage {
  iso3: string;
  name: string;
  source_id: string | null;
  first_day: string | null;
  last_day: string | null;
  events: number;
  scorable: number;
  note: string | null;
}

export interface MoiInfo {
  meta: Record<string, string>;
  coverage: MoiCoverage[];
  verdicts: MoiVerdict[];
}

// The user's definition, verbatim, shown in the panel's About dropdown.
export const MOI_DEFINITION =
  'Missed warning opportunity = a qualifying impact occurred and MUST detected a ' +
  'qualifying signal at an actionable lead time, but the available record contains ' +
  'no corresponding documented warning/action.';
