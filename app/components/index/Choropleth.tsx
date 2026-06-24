'use client';

import React, { useEffect, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { feature } from 'topojson-client';
import { usePipelineStore } from 'app/store/providers/pipeline';
import { loadRegionRisks, riskForRp } from 'app/lib/api/contract';
import type { RiskFields, UnitRisk } from 'app/types/contract';
import { color, severityOfUnit } from 'app/lib/exceedance-ramp';

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

export function Choropleth({ cachedRegions }: Props) {
  const { hazard, window: win, returnPeriod, selectedDate } = usePipelineStore();
  const [topology, setTopology] = useState<any>(null);
  const [fetched, setFetched] = useState<Record<string, UnitRisk>>({});
  const [tip, setTip] = useState<Tip | null>(null);
  const regions = cachedRegions ?? fetched;

  useEffect(() => {
    if (topology) return;
    fetch('/icpac_adm1v3.json')
      .then((res) => res.json())
      .then(setTopology)
      .catch((e) => console.error('Failed to load admin-1 topojson', e));
  }, [topology]);

  useEffect(() => {
    if (cachedRegions) return; // playback cache already supplies this day
    if (!selectedDate) {
      setFetched({});
      return;
    }
    let cancelled = false;
    loadRegionRisks(selectedDate, { hazard, window: win, returnPeriod })
      .then((d) => !cancelled && setFetched(d))
      .catch((e) => {
        console.error('Failed to load region risks', e);
        if (!cancelled) setFetched({});
      });
    return () => {
      cancelled = true;
    };
  }, [cachedRegions, selectedDate, hazard, win, returnPeriod]);

  // Resolve each unit's risk for the selected return period, then derive the
  // continuous ramp severity. Keyed by pcode (real) or shapeID (mock).
  const byKey = useMemo(() => {
    const m = new Map<string, { sev: number; label: string }>();
    for (const [key, unit] of Object.entries(regions)) {
      const fields: RiskFields = riskForRp(unit, returnPeriod);
      m.set(key, { sev: severityOfUnit(fields), label: fields.risk_label });
    }
    return m;
  }, [regions, returnPeriod]);

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
