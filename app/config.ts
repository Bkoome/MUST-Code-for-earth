// API base for client calls. Empty → Next.js rewrites proxy to the backend
// (avoids CORS; works for both the local proxy and Cloud Run).
export const API_BASE_URL = '';

// Live-tile backend — the single mock-vs-live switch. Empty → <LiveMap> uses the
// pre-rendered tiles under /public/mock-tiles; set in .env.local to read live tiles.
export const TITILER_URL = process.env.NEXT_PUBLIC_TITILER_URL ?? '';
export const TIPG_URL = process.env.NEXT_PUBLIC_TIPG_URL ?? '';

// Static data contract (index.json, {date}/region_risks.json). Defaults to /data.
export const DATA_BASE = process.env.NEXT_PUBLIC_DATA_BASE ?? '/data';

// True once the real static-JSON data contract is wired (mock → live).
export const LIVE_DATA = Boolean(process.env.NEXT_PUBLIC_DATA_BASE);

// Placeholder tile date under /public/mock-tiles, shown until live tiles are wired.
export const EXPERIMENTAL_TILE_DATE = '2026-03-04';

// True once the live raster backend is configured (mock → live).
export const LIVE_TILES = Boolean(TITILER_URL);

// East Africa bounding box for the map + mock raster overlay. [west, south, east, north].
export const EA_BBOX: [number, number, number, number] = [21, -12, 52, 23];
