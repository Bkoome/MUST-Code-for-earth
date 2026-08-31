'use client';

// Ensemble "plume" for the signal chapter: every member's cumulative rainfall at the
// forecast hotspot over the SELECTED window (24h..7d) leading into the event. Members
// whose total at the event clears the return-period threshold run warm, the rest stay
// muted; hovering a trajectory lifts it and fades the rest. Data: /xr/ensemble.

import React, { useMemo, useState } from 'react';
import type { EnsembleTrajectory } from 'app/types/exceedance';

interface Props {
  data: EnsembleTrajectory;
}

// SVG user-space canvas; the element itself scales to the card width.
const W = 640;
const H = 300;
const PAD = { l: 40, r: 14, t: 16, b: 28 };
const X0 = PAD.l;
const X1 = W - PAD.r;
const Y0 = PAD.t;
const Y1 = H - PAD.b;

function niceCeil(v: number): number {
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

// Amber -> deep red as a member's event total climbs from the threshold to the peak.
function overColor(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  const from = [245, 158, 11]; // #f59e0b
  const to = [220, 38, 38]; // #dc2626
  const ch = from.map((f, i) => Math.round(f + (to[i] - f) * c));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

export function EnsembleChart({ data }: Props) {
  const { leads, members, threshold_mm, window_h, rp, n_over, n_members, event_index } = data;
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    // Scope the plume to the selected window: keep lead 0..event (the window-end).
    const ev = Math.min(Math.max(event_index, 0), leads.length - 1);
    const n = ev + 1;
    const usedLeads = leads.slice(0, n);
    const rawMax = Math.max(
      threshold_mm * 1.05,
      ...members.map((m) => Math.max(...m.values.slice(0, n))),
    );
    const yMax = niceCeil(rawMax);
    const xFor = (i: number) => X0 + (n <= 1 ? 0 : (i / (n - 1)) * (X1 - X0));
    const yFor = (v: number) => Y1 - (v / yMax) * (Y1 - Y0);
    const paths = members.map((m, idx) => {
      const vals = m.values.slice(0, n);
      const d = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xFor(i)},${yFor(v)}`).join(' ');
      const at = vals[n - 1]; // total at the event (window-end)
      const t = (at - threshold_mm) / Math.max(1, yMax - threshold_mm);
      return {
        idx,
        d,
        label: m.label,
        at,
        over: m.over,
        color: m.over ? overColor(t) : '#5b6b7e',
        ex: xFor(n - 1),
        ey: yFor(at),
      };
    });
    // Draw muted members first so warm, over-threshold lines sit on top.
    const order = [...paths].sort((a, b) => Number(a.over) - Number(b.over));
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));
    // Label a readable subset of leads (always the ends), whatever the resolution.
    const step = Math.max(1, Math.round((n - 1) / 7));
    const set = new Set<number>([0, n - 1]);
    for (let i = 0; i < n; i += step) set.add(i);
    const tickIdx = Array.from(set).sort((a, b) => a - b);
    return {
      usedLeads,
      n,
      paths,
      order,
      yMax,
      xFor,
      yFor,
      yTicks,
      tickIdx,
      yThresh: yFor(threshold_mm),
    };
  }, [leads, members, threshold_mm, event_index]);

  if (model.n < 2) return null;

  // Count down to the event: left edge is the window lead (e.g. 24h / 7d), right edge is the event.
  const tickLabel = (lead: number, i: number) => {
    if (i === model.n - 1) return 'event';
    const toEvent = window_h - lead;
    return toEvent >= 168 ? '7d' : `${toEvent}h`;
  };

  const hovered = hover != null ? model.paths[hover] : null;
  const wLabel = window_h >= 168 ? `${window_h / 24} d` : `${window_h} h`;

  return (
    <div className={`ens${hovered ? ' hovering' : ''}`}>
      <div className='ens-head'>
        {wLabel} rainfall · {n_members} members · {rp}-yr threshold
      </div>
      <div className='ens-plot'>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role='img'
          aria-label={`Ensemble plume: ${n_members} members' cumulative rainfall at the forecast hotspot over the ${wLabel} window; ${n_over} clear the ${rp}-year threshold by the event.`}
          onMouseLeave={() => setHover(null)}
        >
          {/* y gridlines + labels */}
          {model.yTicks.map((v) => {
            const y = model.yFor(v);
            return (
              <g key={`y${v}`}>
                <line className='ens-grid' x1={X0} x2={X1} y1={y} y2={y} />
                <text className='ens-ytick' x={X0 - 6} y={y + 3} textAnchor='end'>
                  {v}
                </text>
              </g>
            );
          })}

          {/* x tick labels: time to the event, starting at the window lead */}
          {model.tickIdx.map((i) => (
            <text
              key={`x${i}`}
              className='ens-xtick'
              x={model.xFor(i)}
              y={H - 9}
              textAnchor='middle'
            >
              {tickLabel(model.usedLeads[i], i)}
            </text>
          ))}

          {/* member trajectories, muted first then warm */}
          {model.order.map((p) => (
            <path
              key={`p${p.idx}`}
              className={`ens-line ${p.over ? 'ma' : 'mb'}${hover === p.idx ? ' hl' : ''}`}
              d={p.d}
              stroke={p.color}
            />
          ))}

          {/* wide invisible hit targets so thin lines are easy to hover */}
          {model.paths.map((p) => (
            <path
              key={`h${p.idx}`}
              className='ens-hit'
              d={p.d}
              onMouseEnter={() => setHover(p.idx)}
            />
          ))}

          {/* return-period threshold across the window */}
          <line className='ens-thresh' x1={X0} x2={X1} y1={model.yThresh} y2={model.yThresh} />
          <text className='ens-thresh-lbl' x={X0 + 4} y={model.yThresh - 5} textAnchor='start'>
            {rp}-yr · {Math.round(threshold_mm)} mm
          </text>

          {/* highlighted member on top */}
          {hovered ? (
            <>
              <path className='ens-line ens-line-hi' d={hovered.d} stroke={hovered.color} />
              <circle
                className='ens-dot'
                cx={hovered.ex}
                cy={hovered.ey}
                r={3.5}
                fill={hovered.color}
              />
            </>
          ) : null}
        </svg>

        {hovered ? (
          <div
            className='ens-tip'
            style={{ left: `${(hovered.ex / W) * 100}%`, top: `${(hovered.ey / H) * 100}%` }}
          >
            <b>{hovered.label}</b>
            <span>
              {Math.round(hovered.at)} mm at event · {hovered.over ? 'over' : 'under'} threshold
            </span>
          </div>
        ) : null}
      </div>
      <div className='ens-cap'>
        <b>
          {n_over}/{n_members}
        </b>{' '}
        members clear the {rp}-year threshold by the event. Hover any trajectory to inspect that
        member.
      </div>
    </div>
  );
}
