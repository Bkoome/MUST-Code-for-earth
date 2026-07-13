// On-demand tile and feed backend (titiler-xarray). Required for the calendar,
// choropleth, storymap, and tiles; set NEXT_PUBLIC_TILER_XR_BASE in .env.local.
export const TILER_XR_BASE = process.env.NEXT_PUBLIC_TILER_XR_BASE ?? '';

// Parked COG/Lambda tile stack (cog-url.ts); kept for a cloud fallback.
export const TITILER_BASE =
  process.env.NEXT_PUBLIC_TITILER_BASE ?? process.env.NEXT_PUBLIC_TITILER_URL ?? '';
export const COG_BASE = process.env.NEXT_PUBLIC_COG_BASE ?? '';

// TiPg Features API for MDX vector overlays; a static file is used when unset.
export const TIPG_URL = process.env.NEXT_PUBLIC_TIPG_URL ?? '';

// East Africa bounding box for the map extent. [west, south, east, north].
export const EA_BBOX: [number, number, number, number] = [21, -12, 52, 23];
