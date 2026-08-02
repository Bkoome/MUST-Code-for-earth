// Traffic-light exceedance-probability ramp, shared by the calendar, choropleth,
// and storymap legend. Mirrors --p0..--p6 in styles/redesign.css.
import type { RiskState } from 'app/types/contract';

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
const NO_SIGNAL = '#eef2f7';

/** Map an exceedance probability p∈[0,1] to a ramp colour. */
export function color(p: number): string {
  if (p < 0.02) return NO_SIGNAL;
  const i = Math.min(RAMP.length - 1, Math.floor(p * RAMP.length));
  return RAMP[i];
}

// Ramp position for a discrete risk_state. The calendar feed carries only the day's
// worst state, not its probability, so map each state to the midpoint of its band.
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
