// Data contract MUST consumes from the grib-icechunks pipeline. The mock backend
// (backend/app.py) emits these same shapes, so the UI is identical in mock and live modes.
// Live mode reads static JSON from NEXT_PUBLIC_DATA_BASE:
//   index.json                → CalendarIndex
//   {date}/region_risks.json  → Record<pcode, UnitRisk>

// Severity classes: -1 No-data, 0 Low, 1 Moderate, 2 Severe, 3 Extreme.
export type RiskState = -1 | 0 | 1 | 2 | 3;

export const RISK_LABEL: Record<RiskState, string> = {
  [-1]: 'No data',
  0: 'Low',
  1: 'Moderate',
  2: 'Severe',
  3: 'Extreme',
};

// Class accents on the exceedance ramp, dark enough for chip text.
export const RISK_COLOR: Record<RiskState, string> = {
  [-1]: '#445577',
  0: '#64748b',
  1: '#d97706',
  2: '#ea580c',
  3: '#dc2626',
};

// Risk fields for a single return period.
export interface RiskFields {
  risk_state: RiskState;
  risk_label: string;
  p_green: number;
  p_yellow: number;
  p_orange: number;
  p_red: number;
}

// Per-admin-1 risk record from {date}/region_risks.json, keyed by pcode.
export interface UnitRisk extends RiskFields {
  pcode: string;
  name: string;
  country: string;
  risk_by_rp?: Record<string, RiskFields>; // keyed by return-period years, e.g. "2" | "5"
}

// index.json: one entry per forecast day. Cell colour is the day's worst unit risk.
export interface CalendarIndexEntry {
  worst_risk: RiskState;
  risk_label: string;
  n_units: number;
}
export type CalendarIndex = Record<string, CalendarIndexEntry>;

// Return periods (years) the risk engine emits a risk_state for.
export const RISK_RETURN_PERIODS = ['2', '5'] as const;

// Map an exceedance probability to a risk class.
export function severityState(p: number): RiskState {
  if (p >= 0.5) return 3;
  if (p >= 0.3) return 2;
  if (p >= 0.15) return 1;
  return 0;
}
