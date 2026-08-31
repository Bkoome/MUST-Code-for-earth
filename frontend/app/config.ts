// Tile and data backend. Set NEXT_PUBLIC_TILER_XR_BASE in .env.local.
export const TILER_XR_BASE = process.env.NEXT_PUBLIC_TILER_XR_BASE ?? '';

// East Africa map extent [west, south, east, north].
export const EA_BBOX: [number, number, number, number] = [21, -12, 52, 23];

// Hero banner photography, cross-faded behind the masthead. Files live in
// public/banner; alt text describes each frame for assistive tech.
export interface HeroBanner {
  src: string;
  alt: string;
}
export const HERO_BANNERS: HeroBanner[] = [
  {
    src: '/banner/flooded-farmland.jpg',
    alt: 'Floodwater covering farmland and a rural road, fence lines submerged to the posts.',
  },
  {
    src: '/banner/rain-catchment.jpg',
    alt: 'A rain-soaked quarry yard below forested hills under heavy cloud.',
  },
  {
    src: '/banner/storm-city.jpg',
    alt: 'A dense storm front massing over a city skyline before rainfall.',
  },
];

// How long each banner frame holds before cross-fading to the next.
export const HERO_BANNER_INTERVAL_MS = 7000;

// Source repository, linked from the footer.
export const REPO_URL = 'https://github.com/Bkoome/MUST-Code-for-earth';

// Basemap style for the storymap. The default is ICPAC's own tileserver-gl — the
// same style East Africa Forest Watch draws, on ICPAC infrastructure and needing
// no key. It replaces CARTO's key-less raster endpoint, which now stamps
// "API KEY REQUIRED" across every tile. Override to point at another MapLibre
// style; blank falls back to the ICPAC one.
export const BASEMAP_STYLE_URL =
  process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL ||
  'https://eahazardswatch.icpac.net/tileserver-gl/styles/droughtwatch/style.json';
