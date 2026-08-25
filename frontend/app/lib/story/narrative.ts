// Deterministic chapter copy templated from the forecast numbers.

import { ENSEMBLE_SIZE, type StoryData } from './data';
import { SOURCE_LABEL } from 'app/types/catalogue';

export interface ChapterCopy {
  kicker: string;
  title: string;
  body: string;
  stats: { value: string; label: string }[];
  scope: string; // what this chapter ranks and over which regions, so a change of subject reads as a change of lens
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
        'return-period threshold anywhere over East Africa.';
  return {
    kicker: 'The signal',
    title,
    body,
    stats: [
      { value: pct(d.p), label: 'exceedance prob.' },
      { value: `${d.members}/${ENSEMBLE_SIZE}`, label: 'members over threshold' },
      { value: severityLabel(d.p), label: 'severity' },
    ],
    scope: 'ranked by ensemble agreement · across all of East Africa',
  };
}

export function observationChapter(d: StoryData): ChapterCopy {
  const top = d.topRegions[0]?.shapeName;
  const w = windowLabel(d.windowH);
  return {
    kicker: 'The observation',
    title: top ? `What actually fell over ${top}.` : 'What actually fell.',
    body:
      `GPM IMERG satellite and gauge estimates show the ${w} rainfall observed over ` +
      'East Africa, to weigh against the forecast signal' +
      (top ? ` over ${top}.` : '.') +
      (top ? ` The figure below is ${top}'s alone — heavier totals fell elsewhere.` : ''),
    stats: [
      { value: w, label: 'window' },
      {
        value: d.obsTopMm != null ? `${Math.round(d.obsTopMm)} mm` : '—',
        label: top ? `${top} · observed` : 'observed rainfall',
      },
      ...(top ? [{ value: top, label: 'forecast hotspot' }] : []),
    ],
    scope: top
      ? `observed rainfall · at the forecast hotspot, ${top}`
      : 'observed rainfall · across East Africa',
  };
}

export function regionsChapter(d: StoryData): ChapterCopy {
  const n = d.regions.filter((r) => r.p > 0).length;
  const names = d.topRegions.map((r) => r.shapeName);

  // Prefer ranking within the recorded flood zones so the decision row tracks known impact.
  const recorded = new Set(footprintGids(d));
  const inZones = d.regions.filter((r) => recorded.has(r.shapeID) && r.p > 0).slice(0, 3);
  const statRegions = inZones.length ? inZones : d.topRegions;

  let body =
    n > 0
      ? `Ranking each admin-1 region by its worst grid cell puts ${names.join(', ')} at the top.`
      : 'Every admin-1 region reads zero exceedance for this run, window, and return period.';
  if (inZones.length) {
    const zoneNames = inZones.map((r) => r.shapeName).join(', ');
    body += ` Of these, ${zoneNames} ${inZones.length === 1 ? 'sits' : 'sit'} inside recorded EM-DAT flood zones.`;
  }
  return {
    kicker: 'The regions',
    title:
      n > 0
        ? `${n} region${n === 1 ? '' : 's'} carr${n === 1 ? 'ies' : 'y'} the signal.`
        : 'No region carries the signal.',
    body,
    stats: statRegions.map((r) => ({ value: severityLabel(r.p), label: r.shapeName })),
    scope: inZones.length
      ? 'ranked by ensemble agreement · every admin-1 region, scored inside the recorded footprint'
      : 'ranked by ensemble agreement · every admin-1 region',
  };
}

// Wettest observed region across the footprint the impact map shades; not "most impacted", EM-DAT carries no per-region magnitude.
function footprintSpotlight(
  d: StoryData,
): { name: string; country: string | null; mm: number } | null {
  const gids = footprintGids(d);
  if (!d.obsRegions || gids.length === 0) return null;
  const names = new Map(d.regions.map((r) => [r.shapeID, r.shapeName]));
  const countries = new Map((d.emdat?.events ?? []).map((e) => [e.iso, e.country])); // GID_1 'TZA.5_1' -> ISO3 prefix keys the event list
  let best: { name: string; country: string | null; mm: number } | null = null;
  for (const gid of gids) {
    const mm = d.obsRegions[gid];
    if (mm == null) continue;
    if (!best || mm > best.mm) {
      best = { name: names.get(gid) ?? gid, country: countries.get(gid.split('.')[0]) ?? null, mm };
    }
  }
  return best;
}

// Every admin-1 unit any recorded event touched. The catalogue pre-flattens this
// across all its sources, so it wins; the EM-DAT-only feed is the fallback for a
// deployment with no catalogue mounted.
export function footprintGids(d: StoryData): string[] {
  const fromCatalogue = d.catalogue?.gids ?? [];
  if (fromCatalogue.length) return fromCatalogue;
  const all = d.emdat?.all_gids ?? [];
  return all.length ? all : (d.emdat?.gids ?? []);
}

// Impact summed over the day's events. Events are counted once each: the same
// flood reaching six regions killed its total, not six times that.
function catalogueTotals(d: StoryData) {
  const events = d.catalogue?.data ?? [];
  const deaths = events.reduce((t, e) => t + (e.deaths ?? 0), 0);
  const affected = events.reduce((t, e) => t + (e.affected ?? 0), 0);
  const sources = Array.from(new Set(events.map((e) => SOURCE_LABEL[e.source] ?? e.source)));
  // A macro link means the source named a unit larger than admin-1, so the region
  // is inside the affected area rather than confirmed. Counted, never hidden.
  const approx = events.reduce(
    (t, e) => t + e.regions.filter((r) => r.method === 'macro').length,
    0,
  );
  return { events, deaths, affected, sources, approx };
}

// Impact act driven by the catalogue: what was recorded, where it landed on the
// admin-1 layer, and what it cost.
function catalogueImpactChapter(d: StoryData): ChapterCopy {
  const { events, deaths, affected, sources, approx } = catalogueTotals(d);
  const gids = footprintGids(d);
  const spot = footprintSpotlight(d);
  const where = spot ? (spot.country ? `${spot.name}, ${spot.country}` : spot.name) : null;
  const w = windowLabel(d.windowH);
  const worst = events[0];

  const stats: ChapterCopy['stats'] = [];
  if (deaths) stats.push({ value: deaths.toLocaleString(), label: 'recorded dead' });
  if (affected) stats.push({ value: affected.toLocaleString(), label: 'affected' });
  stats.push({ value: `${gids.length}`, label: 'admin-1 regions' });
  stats.push({ value: `${events.length}`, label: events.length === 1 ? 'event' : 'events' });

  const title = deaths
    ? `${deaths.toLocaleString()} recorded dead across ${gids.length} admin-1 regions.`
    : gids.length
      ? `Recorded in ${gids.length} admin-1 ${gids.length === 1 ? 'region' : 'regions'}.`
      : 'Recorded, but not placed on a region.';

  let body =
    `${events.length === 1 ? 'One event' : `${events.length} events`} covering this day ` +
    `${events.length === 1 ? 'is' : 'are'} on record in ${sources.join(' and ')}, ` +
    `attributed to ${gids.length} admin-1 ${gids.length === 1 ? 'unit' : 'units'}.`;
  if (worst?.place) body += ` The largest names ${worst.place}.`;
  if (spot) {
    body +=
      ` Across the shaded regions, ${where} saw the highest observed rainfall over the ` +
      `selected ${w} window at ${Math.round(spot.mm)} mm.`;
  }
  body +=
    ' The shading marks where flooding was recorded, not where the most rain fell.';
  if (approx) {
    body +=
      ` ${approx} of these links come from a source naming a unit larger than admin-1, ` +
      'so those regions sit inside the affected area rather than being confirmed individually.';
  }

  return {
    kicker: 'The impact',
    title,
    body,
    stats,
    scope: `ranked by observed rainfall · across all ${gids.length} recorded flood regions`,
  };
}

export function impactChapter(d: StoryData): ChapterCopy {
  if (d.catalogue?.count) return catalogueImpactChapter(d);
  const e = d.emdat;
  const events = e?.events ?? [];
  const primary = events[0];
  const w = windowLabel(d.windowH);
  const spot = footprintSpotlight(d);
  const where = spot ? (spot.country ? `${spot.name}, ${spot.country}` : spot.name) : null;
  const scope = `ranked by observed rainfall · across all ${footprintGids(d).length} recorded flood regions`;

  // Single-event fallback keeps the original card when the payload lacks the events list.
  if (!primary) {
    const stats: { value: string; label: string }[] = [];
    if (spot) stats.push({ value: `${Math.round(spot.mm)} mm`, label: `${spot.name} · observed` });
    if (e?.affected != null) stats.push({ value: e.affected.toLocaleString(), label: 'affected' });
    if (e?.regions != null) stats.push({ value: `${e.regions}`, label: 'admin-1 regions' });
    return {
      kicker: 'The impact',
      title: spot
        ? `Heaviest rain in the footprint: ${spot.name}.`
        : 'EM-DAT records a matching flood.',
      body: spot
        ? `Across the shaded regions EM-DAT records for this flood, ${where} saw the highest observed ` +
          `rainfall over the selected ${w} window at ${Math.round(spot.mm)} mm. EM-DAT marks where ` +
          'flooding was officially recorded, not where the most rain fell.'
        : 'A recorded flood event in EM-DAT matches this forecast day.',
      stats,
      scope,
    };
  }

  const n = events.length;
  const countries = e?.countries ?? 1;
  const total = e?.total_affected;
  const affected = primary.affected ?? total;
  let body = spot
    ? `Across every shaded region EM-DAT records for these floods, ${where} received the highest ` +
      `observed rainfall over the selected ${w} window at ${Math.round(spot.mm)} mm. `
    : '';
  body +=
    `${n} recorded flood${n === 1 ? '' : 's'} across ${countries} ` +
    `countr${countries === 1 ? 'y' : 'ies'} overlap${n === 1 ? 's' : ''} this forecast day` +
    (affected != null
      ? `, affecting about ${affected.toLocaleString()} people across the listed regions.`
      : '.') +
    ` The deadliest: ${primary.country}, ${primary.deaths ?? '?'} deaths (EM-DAT ${primary.event_key}).`;
  // Report the signal within the deadliest event's regions; numbers only, no interpretation.
  if (primary.signal && primary.signal.p >= 0.15 && primary.signal.region) {
    body += ` Within the deadliest event's own regions the ensemble peaked at ${pct(primary.signal.p)} over ${primary.signal.region} (${primary.signal.date} run).`;
  } else if (primary.signal_today) {
    body += ` On this run, the ensemble signal within the deadliest event's own regions reads ${pct(primary.signal_today.p)} at this window and return period.`;
  }
  const stats = [
    ...(spot ? [{ value: `${Math.round(spot.mm)} mm`, label: `${spot.name} · observed` }] : []),
    ...(total != null ? [{ value: total.toLocaleString(), label: 'people affected' }] : []),
    { value: `${n}`, label: 'recorded floods' },
    { value: `${countries}`, label: 'countries' },
  ];
  return {
    kicker: 'The impact',
    title: spot
      ? `Heaviest rain in the footprint: ${spot.name}.`
      : n > 1
        ? 'A regional disaster on record.'
        : 'EM-DAT records a matching flood.',
    body,
    stats: stats.slice(0, 3),
    scope,
  };
}
