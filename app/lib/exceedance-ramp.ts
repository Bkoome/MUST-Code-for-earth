// Traffic-light exceedance-probability ramp, shared by the calendar, choropleth,
// and storymap legend. Mirrors --p0..--p6 in styles/redesign.css.
import type { RiskFields, RiskState } from 'app/types/contract';

export const RAMP = [
  '#ffffb2',
  '#fed976',
  '#feb24c',
  '#fd8d3c',
  '#fc4e2a',
  '#e31a1c',
  '#b10026',
] as const;

// Very low probability reads as "no signal".
export const NO_SIGNAL = '#eef2f7';

/** Map an exceedance probability p∈[0,1] to a ramp colour. */
export function color(p: number): string {
  if (p < 0.02) return NO_SIGNAL;
  const i = Math.min(RAMP.length - 1, Math.floor(p * RAMP.length));
  return RAMP[i];
}

export interface Severity {
  label: 'SEVERE' | 'MODERATE' | 'LOW';
  color: string;
}

/** Severity bucket + accent colour for a day's exceedance probability. */
export function severity(p: number): Severity {
  if (p > 0.66) return { label: 'SEVERE', color: '#d62828' };
  if (p > 0.4) return { label: 'MODERATE', color: '#c77700' };
  return { label: 'LOW', color: '#64748b' };
}

// The risk product is a 4-class state plus a probability vector; the helpers below
// map it onto the continuous ramp so the calendar and choropleth keep their look.

// Continuous severity 0..1 from a unit's probability vector.
export function severityOfUnit(u: Pick<RiskFields, 'p_red' | 'p_orange' | 'p_yellow'>): number {
  return Math.min(1, u.p_red + 0.6 * u.p_orange + 0.3 * u.p_yellow);
}

// Ramp position for a discrete risk_state. index.json carries only the day's worst
// state (no probability vector), so map each state to the midpoint of its band.
const STATE_SEVERITY: Record<RiskState, number> = {
  [-1]: 0,
  0: 0,
  1: 0.22,
  2: 0.42,
  3: 0.75,
};
export function severityOfState(s: RiskState): number {
  return STATE_SEVERITY[s];
}
