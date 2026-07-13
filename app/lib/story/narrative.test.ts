import { describe, expect, it } from 'vitest';
import type { StoryData } from './data';
import {
  footprintChapter,
  regionsChapter,
  severityLabel,
  signalChapter,
  windowLabel,
} from './narrative';

const base: StoryData = {
  date: '2026-03-22',
  windowH: 24,
  rp: 10,
  p: 0.42,
  members: 21,
  tpMaxMm: 87.4,
  regions: [
    { shapeID: 'KEN.8_1', shapeName: 'Garissa', p: 0.42 },
    { shapeID: 'KEN.41_1', shapeName: 'Tana River', p: 0.31 },
    { shapeID: 'SOM.1_1', shapeName: 'Awdal', p: 0.0 },
  ],
  topRegions: [
    { shapeID: 'KEN.8_1', shapeName: 'Garissa', p: 0.42 },
    { shapeID: 'KEN.41_1', shapeName: 'Tana River', p: 0.31 },
  ],
  emdat: null,
};

describe('severityLabel', () => {
  it('maps probability bands to labels', () => {
    expect(severityLabel(0.6)).toBe('EXTREME');
    expect(severityLabel(0.35)).toBe('SEVERE');
    expect(severityLabel(0.2)).toBe('MODERATE');
    expect(severityLabel(0.05)).toBe('LOW');
  });
});

describe('windowLabel', () => {
  it('renders hours and days', () => {
    expect(windowLabel(24)).toBe('24 h');
    expect(windowLabel(168)).toBe('7 d');
  });
});

describe('signalChapter', () => {
  it('templates copy from the forecast numbers', () => {
    const c = signalChapter(base);
    expect(c.title).toContain('Garissa');
    expect(c.body).toContain('21 of 51');
    expect(c.body).toContain('10-year');
    expect(c.stats.map((s) => s.value)).toContain('42%');
  });

  it('is deterministic', () => {
    expect(signalChapter(base)).toEqual(signalChapter({ ...base }));
  });

  it('reports a quiet ensemble when p is zero', () => {
    const c = signalChapter({ ...base, p: 0, members: 0, topRegions: [] });
    expect(c.title).toBe('The ensemble stayed quiet.');
    expect(c.body).toContain('no member');
  });
});

describe('footprintChapter', () => {
  it('carries the peak accumulation', () => {
    const c = footprintChapter(base);
    expect(c.body).toContain('87.4 mm');
    expect(c.stats[0].value).toBe('87.4 mm');
  });

  it('degrades without a peak value', () => {
    const c = footprintChapter({ ...base, tpMaxMm: null });
    expect(c.stats[0].value).toBe('n/a');
  });
});

describe('regionsChapter', () => {
  it('counts and names the regions with signal', () => {
    const c = regionsChapter(base);
    expect(c.title).toBe('2 regions carry the signal.');
    expect(c.body).toContain('Garissa, Tana River');
    expect(c.stats).toHaveLength(2);
  });
});
