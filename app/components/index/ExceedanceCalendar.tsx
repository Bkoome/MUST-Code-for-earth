'use client';

import React, { useMemo } from 'react';
import { usePipelineStore } from 'app/store/providers/pipeline';
import type { CalendarIndex, CalendarIndexEntry } from 'app/types/contract';
import { color, severityOfState } from 'app/lib/exceedance-ramp';

// Calendar geometry.
const CELL = 9;
const GAP = 2;
const STEP = CELL + GAP;
const ROWS = 7;
const TOP = 16;
const LEFT = 26;

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const WD_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

const wdMon = (d: Date) => (d.getDay() + 6) % 7; // Monday-first weekday
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const iso = (d: Date) => d.toISOString().slice(0, 10);

interface Cell {
  iso: string;
  x: number;
  y: number;
  sev: number; // ramp position 0..1, derived from the day's worst risk_state
  label: string; // risk_label for the tooltip
  ev: boolean; // EM-DAT match
  pending: boolean; // in the archive but not summarized yet
}

interface Band {
  year: number;
  w: number;
  h: number;
  monthLabels: { x: number; label: string }[];
  weekdayLabels: { y: number; label: string }[];
  cells: Cell[];
  riskDays: number;
}

function buildBand(
  year: number,
  index: CalendarIndex,
  emdatDates: Set<string>,
  pendingDates: Set<string>,
): Band {
  const jan1 = new Date(year, 0, 1);
  const offset = wdMon(jan1);
  const days = isLeap(year) ? 366 : 365;
  const weeks = Math.ceil((days + offset) / 7);
  const w = LEFT + weeks * STEP + 6;
  const h = TOP + ROWS * STEP;

  const weekdayLabels = WD_LABELS.map((label, r) => ({
    label,
    y: TOP + r * STEP + CELL - 3,
  })).filter((l) => l.label);
  const monthLabels = MONTH_NAMES.map((label, m) => {
    const i = Math.floor((new Date(year, m, 1).getTime() - jan1.getTime()) / 864e5);
    return { label, x: LEFT + Math.floor((i + offset) / 7) * STEP };
  });

  const cells: Cell[] = [];
  let riskDays = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(year, 0, 1 + i);
    const key = iso(d);
    const entry: CalendarIndexEntry | undefined = index[key];
    const state = entry?.worst_risk ?? -1;
    if (state >= 2) riskDays++; // orange + red = elevated-risk day
    const pending = !entry && pendingDates.has(key);
    cells.push({
      iso: key,
      x: LEFT + Math.floor((i + offset) / 7) * STEP,
      y: TOP + wdMon(d) * STEP,
      sev: severityOfState(state),
      label: pending ? 'Summary in progress' : (entry?.risk_label ?? 'No data'),
      ev: emdatDates.has(key),
      pending,
    });
  }
  return { year, w, h, monthLabels, weekdayLabels, cells, riskDays };
}

interface Props {
  index: CalendarIndex;
  emdatDates: Set<string>;
  pendingDates: Set<string>;
  loading: boolean;
  year: number;
  playing: boolean;
}

export function ExceedanceCalendar({
  index,
  emdatDates,
  pendingDates,
  loading,
  year,
  playing,
}: Props) {
  const { selectedDate, setSelectedDate } = usePipelineStore();

  const band = useMemo(
    () => buildBand(year, index, emdatDates, pendingDates),
    [year, index, emdatDates, pendingDates],
  );

  return (
    <section className='widget'>
      <div className='wtitle'>
        Daily exceedance calendar <b>· {year}</b>
        {loading ? <i className='spin inline' /> : null}
      </div>
      <div className='cal-scroll'>
        <div id='cal'>
          <div className='year-band' id={`band-${band.year}`}>
            <div className='yr'>
              <b>{band.year}</b>
              <span>{band.riskDays} elevated-risk days</span>
            </div>
            <svg
              className='cal-svg'
              width={band.w}
              height={band.h}
              viewBox={`0 0 ${band.w} ${band.h}`}
            >
              {band.weekdayLabels.map((l) => (
                <text key={`wd-${l.label}`} x={2} y={l.y}>
                  {l.label}
                </text>
              ))}
              {band.monthLabels.map((l) => (
                <text key={`mo-${l.label}`} x={l.x} y={12}>
                  {l.label}
                </text>
              ))}
              {band.cells.map((c) => {
                const sel = c.iso === selectedDate;
                const cls = [
                  'cell',
                  c.ev ? 'ev' : '',
                  c.pending ? 'pending' : '',
                  sel ? 'sel' : '',
                  sel && playing ? 'cursor' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <rect
                    key={c.iso}
                    className={cls}
                    x={c.x}
                    y={c.y}
                    width={CELL}
                    height={CELL}
                    rx={3}
                    fill={color(c.sev)}
                    onClick={() => setSelectedDate(c.iso)}
                  >
                    <title>{`${c.iso} · ${c.label}`}</title>
                  </rect>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
