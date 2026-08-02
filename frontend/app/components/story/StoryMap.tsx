'use client';

// Pinned MapLibre map for the per-day storymap. Mounted once per story; the active
// chapter moves the camera and toggles layers, and the user can pan and zoom freely.

import React, { useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { EA_BBOX } from 'app/config';
import { xrTpTileUrl, xrExceedanceTileUrl, xrObsTileUrl } from 'app/lib/tiles/xr-url';
import {
  STORY_STYLE,
  RISK_STOPS,
  LAYER_GROUPS,
  EA_BOUNDS_LL,
  paddedBounds,
  type ChapterConfig,
} from './storyConfig';

interface Props {
  active: ChapterConfig | null;
  date: string;
  windowH: number;
  rp: number;
  regionP: Record<string, number>; // gid -> exceedance p, drives the admin-1 fill
  highlightGids: string[]; // regions outlined in the EM-DAT act
}

interface LegendSpec {
  title: string;
  classes?: { color: string; label: string }[];
  gradient?: { css: string; min: string; max: string };
}

// Mirrors the backend EXCEEDANCE_BINS rendering contract.
const EXCEED_CLASSES = [
  { color: '#fed976', label: '2-5%' },
  { color: '#feb24c', label: '5-15%' },
  { color: '#fd8d3c', label: '15-30%' },
  { color: '#f03b20', label: '30-50%' },
  { color: '#bd0026', label: '>50%' },
];

function legendFor(ch: ChapterConfig | null): LegendSpec | null {
  if (!ch) return null;
  if (ch.layers.includes('exceedance')) {
    return { title: 'Members over threshold', classes: EXCEED_CLASSES };
  }
  if (ch.layers.includes('rainfall')) {
    return {
      title: 'Forecast accumulation',
      gradient: {
        css: 'linear-gradient(90deg,#deebf7,#6baed6,#08306b)',
        min: '1 mm',
        max: '100 mm+',
      },
    };
  }
  if (ch.layers.includes('observed')) {
    return {
      title: 'Observed rainfall · GPM IMERG',
      gradient: {
        css: 'linear-gradient(90deg,#deebf7,#6baed6,#08306b)',
        min: '1 mm',
        max: '100 mm+',
      },
    };
  }
  if (ch.layers.includes('risk')) {
    return {
      title: 'Regional exceedance',
      gradient: {
        css: 'linear-gradient(90deg,#1a9850 0%,#a6d96a 30%,#fdd835 50%,#f5a623 65%,#f4733a 80%,#d62828 100%)',
        min: 'Low',
        max: 'High',
      },
    };
  }
  if (ch.layers.includes('emdat')) {
    return {
      title: 'EM-DAT flood match',
      classes: [{ color: '#7c3aed', label: 'Matched regions' }],
    };
  }
  return null;
}

export function StoryMap({ active, date, windowH, rp, regionP, highlightGids }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<ChapterConfig | null>(null);
  const activeRef = useRef<ChapterConfig | null>(null);
  const [stateText, setStateText] = useState('');
  const [userMoved, setUserMoved] = useState(false);
  const [tilesLoading, setTilesLoading] = useState(false);

  // Fly or fit to a chapter's camera target.
  const applyCamera = (el: ChapterConfig, duration: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(el.bounds ?? EA_BOUNDS_LL, {
      padding: el.bounds ? 56 : 24,
      maxZoom: 7,
      duration,
      essential: true,
    });
  };

  // Apply a chapter's camera + layer visibility.
  const applyChapter = (el: ChapterConfig | null) => {
    if (!el) return;
    const map = mapRef.current;
    if (!map || !readyRef.current) {
      pendingRef.current = el;
      return;
    }
    // Honour reduced-motion: jump instead of animating the camera.
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    applyCamera(el, reduce ? 0 : 1400);
    setUserMoved(false);
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
        maxBounds: paddedBounds(EA_BOUNDS_LL, 6),
        attributionControl: {},
      });
      mapRef.current = map;

      // Failed tile/source requests are silent by default; log them, they are
      // the first thing to check when a layer renders blank.
      map.on('error', (e) => {
        // eslint-disable-next-line no-console
        console.warn('[storymap] map error:', e.error?.message ?? e);
      });

      // Track the camera for the overlay readout and the recenter affordance.
      map.on('moveend', () => {
        const c = map.getCenter();
        setStateText(
          `center ${c.lng.toFixed(1)},${c.lat.toFixed(1)} · zoom ${map.getZoom().toFixed(1)} · ${date}`,
        );
      });
      map.on('dragstart', () => setUserMoved(true));
      map.on('wheel', () => setUserMoved(true));

      // Surface raster fetches; a cold date derives server-side and takes a while.
      map.on('sourcedataloading', (e) => {
        if (['exceedance', 'rainfall', 'observed'].includes(e.sourceId)) setTilesLoading(true);
      });
      map.on('idle', () => setTilesLoading(false));

      map.on('load', async () => {
        if (cancelled) return;

        const [fc, region, mask] = await Promise.all([
          fetch('/geo/ea-adm1-geo.json').then((r) => r.json()),
          fetch('/geo/ea-region.json').then((r) => r.json()),
          fetch('/geo/ea-mask.json').then((r) => r.json()),
        ]).catch(() => [null, null, null]);

        if (fc) {
          // The fill reads each region's exceedance p from the `risk` property.
          fc.features.forEach((f: any) => (f.properties.risk = regionP[f.properties.gid] ?? 0));
          map.addSource('adm1', { type: 'geojson', data: fc });
        }

        const [w, s, e, n] = EA_BBOX;
        map.addSource('exceedance', {
          type: 'raster',
          tiles: [xrExceedanceTileUrl(date, windowH, rp)],
          tileSize: 256,
          bounds: [w, s, e, n],
        });
        map.addSource('rainfall', {
          type: 'raster',
          tiles: [xrTpTileUrl(date, windowH)],
          tileSize: 256,
          bounds: [w, s, e, n],
        });
        // GPM IMERG daily observation; only whole-day windows are served.
        if (windowH % 24 === 0) {
          map.addSource('observed', {
            type: 'raster',
            tiles: [xrObsTileUrl(date, windowH)],
            tileSize: 256,
            bounds: [w, s, e, n],
          });
        }
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
        if (map.getSource('observed')) {
          map.addLayer({
            id: 'observed-raster',
            type: 'raster',
            source: 'observed',
            paint: { 'raster-opacity': 0.85 },
            layout: { visibility: 'none' },
          });
        }

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
            filter: ['in', ['get', 'gid'], ['literal', highlightGids]],
            paint: { 'fill-color': '#7c3aed', 'fill-opacity': 0.5 },
            layout: { visibility: 'none' },
          });
        }

        // Region knockout mask: everything outside ICPAC fades to white.
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
            filter: ['in', ['get', 'gid'], ['literal', highlightGids]],
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
    activeRef.current = active;
    applyChapter(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const legend = legendFor(active);

  return (
    <div className='map' ref={containerRef}>
      {legend ? (
        <div className='map-legend'>
          <div className='ml-title'>{legend.title}</div>
          {legend.classes ? (
            <div className='ml-classes'>
              {legend.classes.map((c) => (
                <div key={c.label} className='ml-row'>
                  <i style={{ background: c.color }} />
                  <span>{c.label}</span>
                </div>
              ))}
            </div>
          ) : legend.gradient ? (
            <>
              <div className='ml-bar' style={{ background: legend.gradient.css }} />
              <div className='ml-scale'>
                <span>{legend.gradient.min}</span>
                <span>{legend.gradient.max}</span>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {tilesLoading ? (
        <div className='map-loading'>
          <i className='spin' /> Rendering map field
        </div>
      ) : null}
      {userMoved ? (
        <button
          className='map-recenter'
          onClick={() => activeRef.current && applyChapter(activeRef.current)}
        >
          Recenter
        </button>
      ) : null}
      <div className='overlay'>
        Layer: <b>{active?.layerName ?? 'ensemble exceedance'}</b>
        <br />
        <span className='mono'>{stateText}</span>
      </div>
    </div>
  );
}
