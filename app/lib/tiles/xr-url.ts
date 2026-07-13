// Tile URLs for titiler-xarray, which derives fields from the Icechunk store on demand.
// The server owns colormap/rescale; URLs carry only date, window, member and rp.

import { TILER_XR_BASE } from 'app/config';

// Exceedance dimensions the backend serves (windows in hours, return periods in years).
const EXCEEDANCE_WINDOWS_H = [3, 6, 12, 24, 48, 72, 168] as const;
const EXCEEDANCE_RETURN_PERIODS = [2, 5, 10, 20, 50, 100] as const;

const TILE_PATH = '/xr/tiles/WebMercatorQuad/{z}/{x}/{y}.png';

// Bump when the server rendering contract changes so browsers drop cached tiles.
const RENDER_VERSION = '2';

function assertWindow(windowH: number): void {
  if (!(EXCEEDANCE_WINDOWS_H as readonly number[]).includes(windowH)) {
    throw new Error(`invalid accumulation window: ${windowH}h`);
  }
}

// Forecast rainfall accumulation [0, windowH] in mm, ensemble mean or a named member.
export function xrTpTileUrl(date: string, windowH: number, member = 'mean'): string {
  assertWindow(windowH);
  const qs = new URLSearchParams({
    date,
    layer: 'tp',
    window: `${windowH}h`,
    member,
    v: RENDER_VERSION,
  });
  return `${TILER_XR_BASE}${TILE_PATH}?${qs}`;
}

// Fraction of members whose accumulation exceeds the CMORPH return-period threshold.
export function xrExceedanceTileUrl(date: string, windowH: number, rp: number): string {
  assertWindow(windowH);
  if (!(EXCEEDANCE_RETURN_PERIODS as readonly number[]).includes(rp)) {
    throw new Error(`invalid return period: ${rp}yr`);
  }
  const qs = new URLSearchParams({
    date,
    layer: 'exceedance',
    window: `${windowH}h`,
    rp: String(rp),
    v: RENDER_VERSION,
  });
  return `${TILER_XR_BASE}${TILE_PATH}?${qs}`;
}

// Forecast init dates available in the store.
export async function fetchXrDates(): Promise<string[]> {
  const res = await fetch(`${TILER_XR_BASE}/xr/dates`);
  if (!res.ok) throw new Error(`GET /xr/dates -> ${res.status}`);
  return (await res.json()).dates as string[];
}
