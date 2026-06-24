'use client';

// MapLibre map for the per-day storymap: a raster layer (exceedance/rainfall
// grid) plus an admin-1 risk vector overlay. TITILER_URL / TIPG_URL pick the
// source: unset reads /public/mock-tiles, set reads live TiTiler/TiPg tiles.
// Usage: <LiveMap date="2026-03-04" raster="exceedance" vector="bn-risk" />

import React, { useEffect, useRef, useState } from 'react';
import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { TITILER_URL, TIPG_URL, EA_BBOX } from 'app/config';

// Risk-level (1..5) → colour ramp.
const RISK_COLORS = ['#9ca3af', '#60a5fa', '#34d399', '#f59e0b', '#ef4444'];

// Raster URL: a georeferenced PNG in mock mode, XYZ tiles in live mode.
function rasterImageUrl(date: string): string {
  return `/mock-tiles/raster/${date}.png`;
}
function rasterTileTemplate(date: string, layer: string): string {
  return `${TITILER_URL}/tiles/WebMercatorQuad/{z}/{x}/{y}.png?date=${date}&layer=${layer}`;
}

// Admin-1 vector (GeoJSON) URL: a static file in mock mode, TiPg Features in live mode.
function vectorUrl(date: string, collection: string): string {
  if (!TIPG_URL) return `/mock-tiles/vector/${date}.geojson`;
  return `${TIPG_URL}/collections/${collection}/items?datetime=${date}&f=geojson&limit=1000`;
}

const BLANK_DARK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0a0f1e' } }],
};

interface LiveMapProps {
  date: string;
  raster?: string; // raster layer id (TiTiler), default 'exceedance'
  vector?: string; // vector collection id (TiPg), default 'bn-risk'
  center?: string; // "lon,lat", optional; defaults to fitting EA_BBOX
  zoom?: string;
  height?: string; // CSS height, default 420px
}

export function LiveMap({
  date,
  raster = 'exceedance',
  vector = 'bn-risk',
  center,
  zoom,
  height = '420px',
}: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  // Per-page-view tile/data request count (transformRequest sees every URL).
  const [tileCount, setTileCount] = useState(0);
  const [vectorFeatures, setVectorFeatures] = useState<number | null>(null);
  const live = Boolean(TITILER_URL);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    const meter = { count: 0 };
    // Keep the GL canvas in sync with container/orientation changes.
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(containerRef.current);

    (async () => {
      const maplibre = (await import('maplibre-gl')).default;
      if (cancelled || !containerRef.current) return;

      const [w, s, e, n] = EA_BBOX;
      const parsedCenter = center
        ? (center.replace(/[[\]]/g, '').split(',').map(Number) as [number, number])
        : undefined;

      const map = new maplibre.Map({
        container: containerRef.current,
        style: BLANK_DARK_STYLE,
        center: parsedCenter ?? [(w + e) / 2, (s + n) / 2],
        zoom: zoom ? Number(zoom) : 4.2,
        attributionControl: false,
        // Count every tile/data request the map makes.
        transformRequest: (url: string) => {
          if (/\/tiles\/|\.png|\.geojson|\/items\b/.test(url)) {
            meter.count += 1;
          }
          return { url };
        },
      });
      mapRef.current = map;
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');

      map.on('load', async () => {
        if (cancelled) return;

        // Raster layer (exceedance / rainfall grid)
        if (live) {
          map.addSource('raster-src', {
            type: 'raster',
            tiles: [rasterTileTemplate(date, raster)],
            tileSize: 256,
            bounds: [w, s, e, n],
          });
        } else {
          map.addSource('raster-src', {
            type: 'image',
            url: rasterImageUrl(date),
            coordinates: [
              [w, n],
              [e, n],
              [e, s],
              [w, s],
            ],
          });
        }
        map.addLayer({
          id: 'raster-lyr',
          type: 'raster',
          source: 'raster-src',
          paint: { 'raster-opacity': 0.75 },
        });

        // Vector overlay (admin-1 risk); same code path in mock and live
        try {
          const res = await fetch(vectorUrl(date, vector));
          if (res.ok) {
            const gj = await res.json();
            if (!cancelled && map.getSource('admin1-src') === undefined) {
              map.addSource('admin1-src', { type: 'geojson', data: gj });
              map.addLayer({
                id: 'admin1-fill',
                type: 'fill',
                source: 'admin1-src',
                paint: {
                  'fill-color': [
                    'match',
                    ['get', 'risk_level_int'],
                    1,
                    RISK_COLORS[0],
                    2,
                    RISK_COLORS[1],
                    3,
                    RISK_COLORS[2],
                    4,
                    RISK_COLORS[3],
                    5,
                    RISK_COLORS[4],
                    '#33415540',
                  ],
                  'fill-opacity': 0.45,
                },
              });
              map.addLayer({
                id: 'admin1-line',
                type: 'line',
                source: 'admin1-src',
                paint: { 'line-color': '#94a3b8', 'line-width': 0.5 },
              });
              setVectorFeatures(Array.isArray(gj.features) ? gj.features.length : 0);
            }
          } else {
            setVectorFeatures(0);
          }
        } catch {
          if (!cancelled) setVectorFeatures(0);
        }
      });

      // Update the meter once the map settles.
      map.on('idle', () => {
        if (!cancelled) setTileCount(meter.count);
      });
    })();

    return () => {
      cancelled = true;
      ro.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [date, raster, vector, center, zoom, live]);

  return (
    <div style={{ margin: '1.25rem 0' }}>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height,
          borderRadius: '10px',
          overflow: 'hidden',
          border: '1px solid #1e293b',
        }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.7rem',
          color: '#64748b',
          padding: '4px 6px 0',
        }}
      >
        <span>
          {live ? 'LIVE tiles' : 'MOCK tiles'} · raster:{raster} · vector:{vector} · {date}
          {!live && ' · placeholder data, not final exceedance'}
        </span>
        <span title='Tile/data requests this page-view (cost meter)'>
          {tileCount} reqs{vectorFeatures !== null ? ` · ${vectorFeatures} admin-1` : ''}
        </span>
      </div>
    </div>
  );
}
