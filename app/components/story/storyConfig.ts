// Storymap configuration. The narrative numbers are illustrative mock content; the
// map mechanics (layers, fits, risk ramp) are real and swap to live data unchanged.
import type { StyleSpecification } from 'maplibre-gl';

export interface ChapterStat {
  b: string;
  s: string;
}

export interface ChapterConfig {
  id: string;
  bg: string; // pinned backdrop image
  banner: string; // card banner image
  tag: string;
  k: string; // kicker
  title: string;
  body: string;
  stats: ChapterStat[];
  // map reaction
  layerName: string; // overlay label
  center: [number, number];
  zoom: number;
  datetime: string;
  fit?: 'region';
  layers: string[]; // active layer-group keys
}

const A = '/story-assets/chapters';

// The default four-act story (signal → observation → impact → decision).
// Per-day MDX storymaps will supply their own chapters via <Chapter>; this is the
// built-in demo story used until a day's MDX exists.
export function buildStory(date: string): ChapterConfig[] {
  return [
    {
      id: 'signal',
      bg: `${A}/bg-signal.jpg`,
      banner: `${A}/signal.jpg`,
      tag: 'Forecast · ECMWF ensemble',
      k: 'The signal',
      title: 'Three days out, the ensemble lit up.',
      body:
        'On the run three days prior, 38 of 51 members pushed 24-hour rainfall past the 10-year ' +
        'return-period threshold across the eastern Rift. An unusually tight cluster for a +72 h lead time.',
      stats: [
        { b: '0.74', s: 'exceedance prob.' },
        { b: '38/51', s: 'members over threshold' },
        { b: '+72 h', s: 'lead time' },
      ],
      layerName: 'ensemble exceedance · 24 h',
      center: [36.6, 5.7],
      zoom: 4.0,
      datetime: date,
      fit: 'region',
      layers: ['exceedance'],
    },
    {
      id: 'observation',
      bg: `${A}/bg-observation.jpg`,
      banner: `${A}/observation.jpg`,
      tag: 'Observed · GPM IMERG',
      k: 'The observation',
      title: 'The rain arrived where the members agreed.',
      body:
        'GPM IMERG for the verifying day confirms the footprint — peak accumulations over the Tana ' +
        'and Juba basins, closely tracking the high-probability cells from the forecast.',
      stats: [
        { b: '214 mm', s: 'peak 24 h obs.' },
        { b: '0.81', s: 'spatial hit rate' },
      ],
      layerName: 'observed rainfall · GPM IMERG',
      center: [39.6, -0.6],
      zoom: 5.4,
      datetime: date,
      layers: ['rainfall'],
    },
    {
      id: 'impact',
      bg: `${A}/bg-impact.jpg`,
      banner: `${A}/impact.jpg`,
      tag: 'Recorded · EM-DAT',
      k: 'The impact',
      title: 'EM-DAT records a flood, two days later.',
      body:
        'Riverine flooding across Garissa and Tana River counties. The forecast signal preceded the ' +
        'recorded onset by 48 hours.',
      stats: [
        { b: '46k', s: 'affected' },
        { b: '2', s: 'admin-1 regions' },
        { b: '48 h', s: 'signal lead' },
      ],
      layerName: 'EM-DAT flood match',
      center: [40.0, -1.3],
      zoom: 6.3,
      datetime: date,
      layers: ['emdat'],
    },
    {
      id: 'decision',
      bg: `${A}/bg-decision.jpg`,
      banner: `${A}/decision.jpg`,
      tag: 'Operations · Bayesian risk',
      k: 'The decision support',
      title: 'Admin-1 risk, ready to act on.',
      body:
        'Folding the ensemble signal and IMERG evidence into the Bayesian network yields a per-region ' +
        'risk score — the layer a duty officer actually reads. Tana River posts the highest posterior.',
      stats: [
        { b: 'HIGH', s: 'Tana River' },
        { b: 'MOD', s: 'Garissa' },
      ],
      layerName: 'admin-1 Bayesian risk',
      center: [36.6, 5.7],
      zoom: 4.0,
      datetime: date,
      fit: 'region',
      layers: ['risk'],
    },
  ];
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

// Traffic-light risk ramp for the admin-1 Bayesian fill.
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

// layer-group → MapLibre layer ids a chapter can switch on.
export const LAYER_GROUPS: Record<string, string[]> = {
  exceedance: ['exceedance-raster'],
  rainfall: ['rainfall-raster'],
  emdat: ['adm1-emdat-fill', 'adm1-emdat-line'],
  risk: ['adm1-risk-fill'],
};

export const EVENT_REGIONS = ['Garissa', 'Tana River'];

// Mock per-region BN risk: the event counties run hot, the rest are hashed.
function hashStr(s: string): number {
  let a = 0;
  for (const c of s) a = (a * 31 + c.charCodeAt(0)) >>> 0;
  return a;
}
export function regionRisk(name: string): number {
  if (name === 'Tana River') return 0.88;
  if (name === 'Garissa') return 0.58;
  return ((hashStr(name) % 100) / 100) * 0.55;
}

// Default extent locked to the ICPAC / East Africa region.
export const EA_BOUNDS_LL: [[number, number], [number, number]] = [
  [21.84, -11.75],
  [51.42, 23.15],
];
export function paddedBounds(
  b: [[number, number], [number, number]],
  pad: number,
): [[number, number], [number, number]] {
  return [
    [b[0][0] - pad, b[0][1] - pad],
    [b[1][0] + pad, b[1][1] + pad],
  ];
}

// Faked exceedance/rainfall raster footprint over the Tana / Juba basins.
export const RASTER_BBOX: [number, number, number, number] = [36.5, -3.5, 43.5, 2.5]; // W,S,E,N
type Quad = [[number, number], [number, number], [number, number], [number, number]];
export function rasterCoords(): Quad {
  const [w, s, e, n] = RASTER_BBOX;
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
  ];
}
