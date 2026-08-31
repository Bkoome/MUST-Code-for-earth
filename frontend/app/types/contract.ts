// Risk shapes the index views consume; the data client lifts backend rows into these.

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

// Per-admin-1 risk record, keyed by the backend's admin-1 gid.
export interface UnitRisk {
  name: string;
  risk_state: RiskState;
  risk_label: string;
  p: number; // exceedance probability for the selected window + return period
}

// One entry per forecast day. Cell colour is the day's worst unit risk.
export interface CalendarIndexEntry {
  worst_risk: RiskState;
  risk_label: string;
  n_units: number;
  // Worst admin-1 exceedance probability for the day. Kept alongside the
  // 4-level class so views that rank or shade days can use the value itself.
  p: number;
}
export type CalendarIndex = Record<string, CalendarIndexEntry>;

// Map an exceedance probability to a risk class.
export function severityState(p: number): RiskState {
  if (p >= 0.5) return 3;
  if (p >= 0.3) return 2;
  if (p >= 0.15) return 1;
  return 0;
}
