// Traffic-light exceedance-probability ramp, shared by the calendar, choropleth,
// and storymap legend. Mirrors --p0..--p6 in styles/redesign.css.

export const RAMP = [
  '#ffffb2',
  '#fed976',
  '#feb24c',
  '#fd8d3c',
  '#fc4e2a',
  '#e31a1c',
  '#b10026',
] as const;

// Very low probability reads as "no signal": a neutral grey, deliberately not a
// paler step of the ramp. Grey is a *category* ("nothing here"), not a lower
// value, which is why it may sit slightly darker than the pale-yellow first step
// without implying more signal — the hue difference carries the distinction.
// It must stay clearly separable from the white chart surface, or the map
// vanishes on days when no region is over threshold.
const NO_SIGNAL = '#e3e9ec';

/** Map an exceedance probability p∈[0,1] to a ramp colour. */
export function color(p: number): string {
  if (p < 0.02) return NO_SIGNAL;
  const i = Math.min(RAMP.length - 1, Math.floor(p * RAMP.length));
  return RAMP[i];
}
