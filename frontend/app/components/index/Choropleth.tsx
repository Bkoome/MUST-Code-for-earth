'use client';

import React, { useEffect, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { feature } from 'topojson-client';
import { usePipelineStore } from 'app/store/providers/pipeline';
import { loadRegionRisks } from 'app/lib/api/contract';
import type { UnitRisk } from 'app/types/contract';
import { color } from 'app/lib/exceedance-ramp';

const VB_W = 340;
const VB_H = 300;

interface Tip {
  name: string;
  label: string;
  sev: number;
  x: number;
  y: number;
}

interface Props {
  // Supplied by playback when the day is already buffered, so the map repaints
  // instantly during a time-lapse instead of refetching per tick.
  cachedRegions?: Record<string, UnitRisk> | null;
}

const PENDING_RETRY_MS = 5000;

export function Choropleth({ cachedRegions }: Props) {
  const { hazard, window: win, returnPeriod, selectedDate } = usePipelineStore();
  const [topology, setTopology] = useState<any>(null);
  const [fetched, setFetched] = useState<Record<string, UnitRisk>>({});
  const [state, setState] = useState<'idle' | 'loading' | 'pending'>('idle');
  const [tip, setTip] = useState<Tip | null>(null);
  const regions = cachedRegions ?? fetched;

  useEffect(() => {
    if (topology) return;
    fetch('/icpac_adm1v3.json')
      .then((res) => res.json())
      .then(setTopology)
      .catch((e) => console.error('Failed to load admin-1 topojson', e));
  }, [topology]);

  // The batch supplies summarized days; only unsummarized days hit the single-day
  // endpoint, which answers 202 until the builder derives them.
  useEffect(() => {
    if (cachedRegions) {
      setState('idle');
      return;
    }
    if (!selectedDate) {
      setFetched({});
      setState('idle');
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const load = () => {
      setState((s) => (s === 'pending' ? s : 'loading'));
      loadRegionRisks(selectedDate, { hazard, window: win, returnPeriod })
        .then((d) => {
          if (cancelled) return;
          if (d === 'pending') {
            setState('pending');
            setFetched({});
            timer = window.setTimeout(load, PENDING_RETRY_MS);
            return;
          }
          setFetched(d);
          setState('idle');
        })
        .catch((e) => {
          console.error('Failed to load region risks', e);
          if (!cancelled) {
            setFetched({});
            setState('idle');
          }
        });
    };
    load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [cachedRegions, selectedDate, hazard, win, returnPeriod]);

  // Exceedance probability doubles as the ramp position, keyed by admin-1 gid.
  const byKey = useMemo(() => {
    const m = new Map<string, { sev: number; label: string }>();
    for (const [key, unit] of Object.entries(regions)) {
      m.set(key, { sev: unit.p, label: unit.risk_label });
    }
    return m;
  }, [regions]);

  const paths = useMemo(() => {
    if (!topology) return [];
    const geojson: any = feature(topology, topology.objects.icpac_adm1v3);
    const projection = d3.geoMercator().fitSize([VB_W, VB_H], geojson);
    const path = d3.geoPath(projection);
    return geojson.features.map((f: any) => ({
      gid: f.properties.GID_1 as string,
      name: f.properties.NAME_1 as string,
      d: path(f) ?? '',
    }));
  }, [topology]);

  return (
    <section className='widget'>
      <div className='wtitle'>
        Admin-1 affected regions <b>{selectedDate ? `· ${selectedDate}` : '(select a day)'}</b>
      </div>
      <div className='choro'>
        {state !== 'idle' ? (
          <div className='choro-status'>
            <i className='spin' />
            {state === 'pending' ? 'Preparing this day on the server' : 'Loading regions'}
          </div>
        ) : null}
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio='xMidYMid meet'>
          {paths.map((p: any) => {
            const hit = byKey.get(p.gid);
            const sev = hit?.sev ?? 0;
            return (
              <path
                key={p.gid}
                className='adm'
                d={p.d}
                fill={color(sev)}
                onMouseMove={(e) =>
                  setTip({
                    name: p.name,
                    label: hit?.label ?? 'No data',
                    sev,
                    x: e.clientX,
                    y: e.clientY,
                  })
                }
                onMouseLeave={() => setTip(null)}
              />
            );
          })}
        </svg>
      </div>
      {tip ? (
        <div className='choro-tip' style={{ display: 'block', left: tip.x + 14, top: tip.y + 14 }}>
          <b>{tip.name}</b>
          <br />
          <span>
            {tip.label} · severity {tip.sev.toFixed(2)}
          </span>
        </div>
      ) : null}
    </section>
  );
}
