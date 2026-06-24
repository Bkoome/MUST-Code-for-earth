'use client';

// Pinned MapLibre map for the per-day storymap. Mounted once; reacts to the active
// chapter by moving the camera and toggling layers. Mock raster fields are drawn
// in-browser as canvas heat blobs; live mode swaps them for TiTiler/TiPg tile
// sources (see <LiveMap>).

import React, { useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import {
  STORY_STYLE,
  RISK_STOPS,
  LAYER_GROUPS,
  EVENT_REGIONS,
  regionRisk,
  EA_BOUNDS_LL,
  paddedBounds,
  rasterCoords,
  type ChapterConfig,
} from './storyConfig';

// Render a radial heat field to a data URL (mock raster, browser-only).
function heatDataURL(
  blobs: { x: number; y: number; r: number }[],
  ramp: [number, string][],
): string {
  const S = 360;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  blobs.forEach((b) => {
    const g = ctx.createRadialGradient(b.x * S, b.y * S, 0, b.x * S, b.y * S, b.r * S);
    ramp.forEach(([stop, col]) => g.addColorStop(stop, col));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  });
  return cv.toDataURL();
}

interface Props {
  active: ChapterConfig | null;
}

export function StoryMap({ active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<ChapterConfig | null>(null);
  const [stateText, setStateText] = useState('');

  // Apply a chapter's camera + layer visibility.
  const applyChapter = (el: ChapterConfig | null) => {
    if (!el) return;
    setStateText(
      `center ${el.center[0]},${el.center[1]} · zoom ${el.zoom.toFixed(1)} · ${el.datetime}`,
    );
    const map = mapRef.current;
    if (!map || !readyRef.current) {
      pendingRef.current = el;
      return;
    }
    // Honour reduced-motion: jump instead of animating the camera.
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duration = reduce ? 0 : 1400;
    if (el.fit === 'region') {
      map.fitBounds(EA_BOUNDS_LL, { padding: 24, duration, essential: true });
    } else {
      map.flyTo({ center: el.center, zoom: el.zoom, duration, essential: true });
    }
    const activeGroups = new Set(el.layers);
    Object.entries(LAYER_GROUPS).forEach(([key, ids]) => {
      const vis = activeGroups.has(key) ? 'visible' : 'none';
      ids.forEach((id) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
      });
    });
  };

  // Mount the map once.
  useEffect(() => {
    let cancelled = false;
    // Keep the GL canvas in sync with container/orientation changes.
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    if (containerRef.current) ro.observe(containerRef.current);
    (async () => {
      const maplibre = (await import('maplibre-gl')).default;
      if (cancelled || !containerRef.current) return;

      const map = new maplibre.Map({
        container: containerRef.current,
        style: STORY_STYLE,
        bounds: EA_BOUNDS_LL,
        fitBoundsOptions: { padding: 24 },
        maxBounds: paddedBounds(EA_BOUNDS_LL, 4),
        interactive: false,
        attributionControl: {},
      });
      mapRef.current = map;

      const EXCEED_URL = heatDataURL(
        [
          { x: 0.52, y: 0.62, r: 0.5 },
          { x: 0.3, y: 0.36, r: 0.34 },
        ],
        [
          [0, 'rgba(214,40,40,0.85)'],
          [0.28, 'rgba(244,115,58,0.7)'],
          [0.52, 'rgba(253,216,53,0.5)'],
          [0.76, 'rgba(102,189,99,0.3)'],
          [1, 'rgba(26,152,80,0)'],
        ],
      );
      const RAIN_URL = heatDataURL(
        [
          { x: 0.54, y: 0.64, r: 0.46 },
          { x: 0.66, y: 0.52, r: 0.3 },
        ],
        [
          [0, 'rgba(31,120,255,0.82)'],
          [0.4, 'rgba(47,143,176,0.55)'],
          [0.75, 'rgba(124,196,168,0.28)'],
          [1, 'rgba(124,196,168,0)'],
        ],
      );

      map.on('load', async () => {
        if (cancelled) return;

        // admin-1 polygons (+ mock risk) + region geometry
        const [fc, region, mask] = await Promise.all([
          fetch('/geo/ea-adm1-geo.json').then((r) => r.json()),
          fetch('/geo/ea-region.json').then((r) => r.json()),
          fetch('/geo/ea-mask.json').then((r) => r.json()),
        ]).catch(() => [null, null, null]);

        if (fc) {
          fc.features.forEach((f: any) => (f.properties.risk = regionRisk(f.properties.name)));
          map.addSource('adm1', { type: 'geojson', data: fc });
        }

        // raster overlays (mock canvas heat fields)
        map.addSource('exceedance', {
          type: 'image',
          url: EXCEED_URL,
          coordinates: rasterCoords(),
        });
        map.addSource('rainfall', { type: 'image', url: RAIN_URL, coordinates: rasterCoords() });
        map.addLayer({
          id: 'exceedance-raster',
          type: 'raster',
          source: 'exceedance',
          paint: { 'raster-opacity': 0.85 },
          layout: { visibility: 'none' },
        });
        map.addLayer({
          id: 'rainfall-raster',
          type: 'raster',
          source: 'rainfall',
          paint: { 'raster-opacity': 0.85 },
          layout: { visibility: 'none' },
        });

        if (fc) {
          map.addLayer({
            id: 'adm1-risk-fill',
            type: 'fill',
            source: 'adm1',
            paint: { 'fill-color': RISK_STOPS, 'fill-opacity': 0.62 },
            layout: { visibility: 'none' },
          });
          map.addLayer({
            id: 'adm1-emdat-fill',
            type: 'fill',
            source: 'adm1',
            filter: ['in', ['get', 'name'], ['literal', EVENT_REGIONS]],
            paint: { 'fill-color': '#7c3aed', 'fill-opacity': 0.5 },
            layout: { visibility: 'none' },
          });
        }

        // region knockout mask: everything outside ICPAC fades to white
        if (mask) {
          map.addSource('ea-mask', { type: 'geojson', data: mask });
          map.addLayer({
            id: 'region-mask',
            type: 'fill',
            source: 'ea-mask',
            paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.6 },
          });
        }

        if (fc) {
          map.addLayer({
            id: 'adm1-emdat-line',
            type: 'line',
            source: 'adm1',
            filter: ['in', ['get', 'name'], ['literal', EVENT_REGIONS]],
            paint: { 'line-color': '#7c3aed', 'line-width': 2 },
            layout: { visibility: 'none' },
          });
          map.addLayer({
            id: 'adm1-line',
            type: 'line',
            source: 'adm1',
            paint: { 'line-color': 'rgba(71,85,105,0.28)', 'line-width': 0.5 },
          });
        }

        if (region) {
          map.addSource('ea-region', { type: 'geojson', data: region });
          map.addLayer({
            id: 'region-outline',
            type: 'line',
            source: 'ea-region',
            paint: { 'line-color': '#475569', 'line-width': 1.2 },
          });
        }

        map.setMinZoom(Math.max(0, map.getZoom() - 0.25));
        readyRef.current = true;
        map.resize();
        applyChapter(pendingRef.current ?? active);
      });
    })();

    return () => {
      cancelled = true;
      ro.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to chapter changes.
  useEffect(() => {
    applyChapter(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const showRiskLegend = Boolean(active?.layers.includes('risk'));

  return (
    <div className='map' ref={containerRef}>
      <div className='map-legend' hidden={!showRiskLegend}>
        <div className='ml-title'>Risk score</div>
        <div className='ml-bar' />
        <div className='ml-scale'>
          <span>Low</span>
          <span>Moderate</span>
          <span>High</span>
        </div>
      </div>
      <div className='overlay'>
        Layer: <b>{active?.layerName ?? 'ensemble exceedance · 24 h'}</b>
        <br />
        <span className='mono'>{stateText}</span>
      </div>
    </div>
  );
}
