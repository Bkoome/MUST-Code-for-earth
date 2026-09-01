// Camera targets computed from admin-1 geometry, shared by the story chapters.

export type LngLatBounds = [[number, number], [number, number]];

interface Adm1Feature {
  properties: { gid: string; name: string };
  geometry: { type: string; coordinates: unknown };
}

export interface Adm1Collection {
  features: Adm1Feature[];
}

let adm1Promise: Promise<Adm1Collection> | null = null;

// One shared fetch of the admin-1 polygons for camera math and map layers.
export function loadAdm1(): Promise<Adm1Collection> {
  if (!adm1Promise) {
    adm1Promise = fetch('/geo/ea-adm1-geo.json').then((r) => {
      if (!r.ok) throw new Error(`adm1 geojson unavailable (${r.status})`);
      return r.json();
    });
    adm1Promise.catch(() => {
      adm1Promise = null;
    });
  }
  return adm1Promise;
}

// Walk nested coordinate arrays and extend the bbox with every position.
function extend(coords: unknown, box: { w: number; s: number; e: number; n: number }): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number') {
    const [lng, lat] = coords as number[];
    box.w = Math.min(box.w, lng);
    box.e = Math.max(box.e, lng);
    box.s = Math.min(box.s, lat);
    box.n = Math.max(box.n, lat);
    return;
  }
  for (const c of coords) extend(c, box);
}

/** Union bbox of the named regions; null when none match. */
export function boundsForRegions(fc: Adm1Collection, gids: string[]): LngLatBounds | null {
  const wanted = new Set(gids);
  const box = { w: Infinity, s: Infinity, e: -Infinity, n: -Infinity };
  let hits = 0;
  for (const f of fc.features) {
    if (!wanted.has(f.properties.gid)) continue;
    extend(f.geometry.coordinates, box);
    hits++;
  }
  if (hits === 0) return null;
  return [
    [box.w, box.s],
    [box.e, box.n],
  ];
}
