// Deterministic chapter copy templated from the forecast numbers.

import { ENSEMBLE_SIZE, type StoryData } from './data';

export interface ChapterCopy {
  kicker: string;
  title: string;
  body: string;
  stats: { value: string; label: string }[];
}

export function severityLabel(p: number): string {
  if (p >= 0.5) return 'EXTREME';
  if (p >= 0.3) return 'SEVERE';
  if (p >= 0.15) return 'MODERATE';
  return 'LOW';
}

export function windowLabel(windowH: number): string {
  return windowH >= 168 ? `${windowH / 24} d` : `${windowH} h`;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

export function signalChapter(d: StoryData): ChapterCopy {
  const top = d.topRegions[0]?.shapeName;
  const w = windowLabel(d.windowH);
  const title =
    d.p >= 0.3
      ? `The ensemble lit up over ${top}.`
      : d.p >= 0.15
        ? `A moderate signal formed over ${top}.`
        : d.p > 0
          ? 'A weak signal, worth watching.'
          : 'The ensemble stayed quiet.';
  const body =
    d.p > 0
      ? `On the ${d.date} run, ${d.members} of ${ENSEMBLE_SIZE} members pushed ${w} rainfall ` +
        `past the ${d.rp}-year return-period threshold` +
        (top ? `, with the strongest agreement over ${top}.` : '.')
      : `On the ${d.date} run, no member pushed ${w} rainfall past the ${d.rp}-year ` +
        'return-period threshold anywhere in the ICPAC domain.';
  return {
    kicker: 'The signal',
    title,
    body,
    stats: [
      { value: pct(d.p), label: 'exceedance prob.' },
      { value: `${d.members}/${ENSEMBLE_SIZE}`, label: 'members over threshold' },
      { value: severityLabel(d.p), label: 'severity' },
    ],
  };
}

export function footprintChapter(d: StoryData): ChapterCopy {
  const top = d.topRegions[0]?.shapeName;
  const w = windowLabel(d.windowH);
  const peak = d.tpMaxMm != null ? `${d.tpMaxMm} mm` : 'n/a';
  return {
    kicker: 'The footprint',
    title: top ? `Forecast rain concentrates over ${top}.` : 'A dispersed rainfall footprint.',
    body:
      `The ensemble-mean ${w} accumulation` +
      (d.tpMaxMm != null ? ` peaks at ${d.tpMaxMm} mm` : '') +
      ' inside the ICPAC domain. The shading is the forecast field itself, not an observation.',
    stats: [
      { value: peak, label: `peak ${w} accumulation` },
      { value: w, label: 'window' },
      ...(top ? [{ value: top, label: 'peak region' }] : []),
    ],
  };
}

export function regionsChapter(d: StoryData): ChapterCopy {
  const n = d.regions.filter((r) => r.p > 0).length;
  const names = d.topRegions.map((r) => r.shapeName);
  return {
    kicker: 'The regions',
    title:
      n > 0
        ? `${n} region${n === 1 ? '' : 's'} carr${n === 1 ? 'ies' : 'y'} the signal.`
        : 'No region carries the signal.',
    body:
      n > 0
        ? `Ranking each admin-1 region by its worst grid cell puts ${names.join(', ')} at the top.`
        : 'Every admin-1 region reads zero exceedance for this run, window, and return period.',
    stats: d.topRegions.map((r) => ({ value: severityLabel(r.p), label: r.shapeName })),
  };
}

export function impactChapter(d: StoryData): ChapterCopy {
  const e = d.emdat;
  const stats: { value: string; label: string }[] = [];
  if (e?.affected != null) stats.push({ value: e.affected.toLocaleString(), label: 'affected' });
  if (e?.regions != null) stats.push({ value: `${e.regions}`, label: 'admin-1 regions' });
  if (e?.lead_h != null) stats.push({ value: `${e.lead_h} h`, label: 'signal lead' });
  return {
    kicker: 'The impact',
    title: 'EM-DAT records a matching flood.',
    body:
      'A recorded flood event in EM-DAT matches this forecast day' +
      (e?.lead_h != null ? `; the ensemble signal preceded the recorded onset by ${e.lead_h} hours.` : '.'),
    stats,
  };
}
