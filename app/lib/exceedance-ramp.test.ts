import { describe, it, expect } from 'vitest';
import { color, severity, RAMP, NO_SIGNAL } from 'app/lib/exceedance-ramp';

describe('color(p) exceedance ramp', () => {
  it('returns the no-signal slate below 0.02', () => {
    expect(color(0)).toBe(NO_SIGNAL);
    expect(color(0.019)).toBe(NO_SIGNAL);
  });

  it('maps the low end to pale yellow and the high end to deep red', () => {
    expect(color(0.05)).toBe(RAMP[0]); // floor(0.05*7)=0
    expect(color(1)).toBe(RAMP[RAMP.length - 1]); // clamped to last stop
    expect(color(0.99)).toBe(RAMP[6]);
  });

  it('is monotonic across the ramp buckets', () => {
    const idx = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95].map((p) => RAMP.indexOf(color(p) as any));
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThanOrEqual(idx[i - 1]);
  });
});

describe('severity(p)', () => {
  it('buckets low / moderate / severe', () => {
    expect(severity(0.2).label).toBe('LOW');
    expect(severity(0.5).label).toBe('MODERATE');
    expect(severity(0.7).label).toBe('SEVERE');
  });
});
