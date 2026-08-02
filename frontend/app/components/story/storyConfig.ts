// Storymap configuration: chapters are assembled from the forecast data, the map
// mechanics (layers, camera fits, ramps) are shared constants.
import type { StyleSpecification } from 'maplibre-gl';
import { boundsForRegions, type Adm1Collection, type LngLatBounds } from 'app/lib/story/camera';
import type { StoryData } from 'app/lib/story/data';
import type { EnsembleTrajectory } from 'app/types/exceedance';
import {
  footprintGids,
  impactChapter,
  observationChapter,
  regionsChapter,
  signalChapter,
  windowLabel,
} from 'app/lib/story/narrative';

export interface ChapterStat {
  value: string;
  label: string;
}

export interface ChapterConfig {
  id: string;
  bg: string; // pinned backdrop image
  banner: string; // card banner image
  tag: string;
  kicker: string;
  title: string;
  body: string;
  stats: ChapterStat[];
  scope: string; // what the chapter ranks and over which regions
  // map reaction
  layerName: string; // overlay label
  datetime: string;
  bounds?: LngLatBounds; // camera target; falls back to the EA extent
  layers: string[]; // active layer-group keys
  raster?: 'exceedance' | 'tp' | 'obs';
  windowH?: number; // accumulation window (hours)
  rp?: number; // return period (years)
  ensemble?: EnsembleTrajectory | null; // per-member trajectory chart (signal chapter only)
}

const A = '/story-assets/chapters';

// Chapters derived from one forecast day; acts without data are omitted.
export function buildStory(data: StoryData, adm1: Adm1Collection): ChapterConfig[] {
  const topGids = data.topRegions.map((r) => r.shapeID);
  const signalBounds = boundsForRegions(adm1, topGids) ?? undefined;
  const peakBounds = boundsForRegions(adm1, topGids.slice(0, 1)) ?? undefined;
  const w = windowLabel(data.windowH);

  const chapters: ChapterConfig[] = [
    {
      id: 'signal',
      bg: `${A}/bg-signal.jpg`,
      banner: `${A}/signal.jpg`,
      tag: 'Forecast · ECMWF ensemble',
      ...signalChapter(data),
      layerName: `ensemble exceedance · ${w}`,
      datetime: data.date,
      bounds: signalBounds,
      layers: ['exceedance'],
      raster: 'exceedance',
      windowH: data.windowH,
      rp: data.rp,
      ensemble: data.ensemble,
    },
    {
      id: 'observation',
      bg: `${A}/bg-observation.jpg`,
      banner: `${A}/observation.jpg`,
      tag: 'Observed · GPM IMERG',
      ...observationChapter(data),
      layerName: `observed rainfall · ${w}`,
      datetime: data.date,
      bounds: peakBounds,
      layers: ['observed'],
      raster: 'obs',
      windowH: data.windowH,
    },
  ];

  // Impact follows the observation so the recorded flood answers what fell.
  if (data.emdat) {
    const impactGids = footprintGids(data); // same footprint the impact copy ranks over
    const emdatBounds = impactGids.length
      ? (boundsForRegions(adm1, impactGids) ?? signalBounds)
      : signalBounds;
    chapters.push({
      id: 'impact',
      bg: `${A}/bg-impact.jpg`,
      banner: `${A}/impact.jpg`,
      tag: 'Recorded · EM-DAT',
      ...impactChapter(data),
      layerName: 'EM-DAT flood match',
      datetime: data.date,
      bounds: emdatBounds,
      layers: ['emdat'],
    });
  }

  chapters.push({
    id: 'regions',
    bg: `${A}/bg-decision.jpg`,
    banner: `${A}/decision.jpg`,
    tag: 'Decision support · regional exceedance',
    ...regionsChapter(data),
    layerName: 'exceedance by admin-1 region',
    datetime: data.date,
    layers: ['risk'],
  });
  return chapters;
}

// Map constants.

// Carto Positron (key-less raster basemap).
export const STORY_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'carto-light': {
      type: 'raster',
      tileSize: 256,
      tiles: ['a', 'b', 'c', 'd'].map(
        (s) => `https://${s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png`,
      ),
      attribution: '© OpenStreetMap contributors © CARTO',
    },
  },
  layers: [{ id: 'carto-light', type: 'raster', source: 'carto-light' }],
};

// Traffic-light ramp for the admin-1 exceedance fill (feature property `risk` in [0,1]).
export const RISK_STOPS: any = [
  'interpolate',
  ['linear'],
  ['get', 'risk'],
  0,
  '#1a9850',
  0.3,
  '#a6d96a',
  0.5,
  '#fdd835',
  0.65,
  '#f5a623',
  0.8,
  '#f4733a',
  1,
  '#d62828',
];

// layer-group -> MapLibre layer ids a chapter can switch on.
export const LAYER_GROUPS: Record<string, string[]> = {
  exceedance: ['exceedance-raster'],
  rainfall: ['rainfall-raster'],
  observed: ['observed-raster'],
  emdat: ['adm1-emdat-fill', 'adm1-emdat-line'],
  risk: ['adm1-risk-fill'],
};

// Default extent locked to the ICPAC / East Africa region.
export const EA_BOUNDS_LL: LngLatBounds = [
  [21.84, -11.75],
  [51.42, 23.15],
];
export function paddedBounds(b: LngLatBounds, pad: number): LngLatBounds {
  return [
    [b[0][0] - pad, b[0][1] - pad],
    [b[1][0] + pad, b[1][1] + pad],
  ];
}
