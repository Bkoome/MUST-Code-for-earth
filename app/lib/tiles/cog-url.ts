// TiTiler COG tile URLs for the storymap rasters — the one place tile URLs are
// built (docs/SWAP-TO-REAL-BACKEND.md §4). Keys name COGs under COG_BASE; the
// ?url= param is resolved server-side by TiTiler, so COG_BASE may be s3://.

import { TITILER_BASE, COG_BASE } from 'app/config';
import { RISK_COLOR } from 'app/types/contract';

// Exceedance dimensions the pipeline emits (windows in hours, RPs in years).
export const EXCEEDANCE_WINDOWS_H = [3, 6, 12, 24, 48, 72, 168] as const;
export const EXCEEDANCE_RETURN_PERIODS = [2, 5, 10, 20, 50, 100] as const;

export function gpmCogKey(date: string): string {
  return `gpm_${date}.tif`;
}

export function exceedanceCogKey(date: string, windowH: number, rp: number): string {
  if (!(EXCEEDANCE_WINDOWS_H as readonly number[]).includes(windowH)) {
    throw new Error(`invalid exceedance window: ${windowH}h`);
  }
  if (!(EXCEEDANCE_RETURN_PERIODS as readonly number[]).includes(rp)) {
    throw new Error(`invalid return period: ${rp}yr`);
  }
  return `exceedance_${date}_${windowH}_${rp}.tif`;
}

export function riskCogKey(date: string): string {
  return `risk_${date}.tif`;
}

// Discrete risk colormap (risk_state 0..3), kept identical to the vector legend.
export const RISK_CMAP_JSON = JSON.stringify({
  0: RISK_COLOR[0],
  1: RISK_COLOR[1],
  2: RISK_COLOR[2],
  3: RISK_COLOR[3],
});

// Rendering params per COG kind (contract §4).
function renderParams(key: string): string {
  if (key.startsWith('risk_')) return `colormap=${encodeURIComponent(RISK_CMAP_JSON)}`;
  if (key.startsWith('gpm_')) return 'colormap_name=blues&rescale=0,100';
  return 'colormap_name=ylorrd&rescale=0,1'; // exceedance
}

// XYZ tile URL template for MapLibre ({z}/{x}/{y} placeholders kept literal).
export function cogTileUrl(key: string): string {
  return (
    `${TITILER_BASE}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png` +
    `?url=${encodeURIComponent(`${COG_BASE}/${key}`)}&${renderParams(key)}`
  );
}
