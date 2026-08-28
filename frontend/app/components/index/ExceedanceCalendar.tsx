'use client';

import React, { useMemo } from 'react';
import { usePipelineStore } from 'app/store/providers/pipeline';
import type { CalendarIndex, CalendarIndexEntry } from 'app/types/contract';
import type { DayVerdict, MoiVerdict } from 'app/types/moi';
import { HATCH_ID, VERDICT_COLOR, VERDICT_LABEL } from 'app/types/moi';
import { color } from 'app/lib/exceedance-ramp';
import { MoiHatch } from './MoiHatch';

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
  sev: number; // the day's worst admin-1 exceedance probability, 0..1
  label: string; // risk_label for the tooltip
  ev: boolean; // EM-DAT match
  pending: boolean; // in the archive but not summarized yet
  verdict: MoiVerdict | null; // the day's worst outcome, null where nothing is scorable
}

// A day with no verdict is not a good day, it is a day with nothing to say about, so it
// takes the same quiet grey the ramp gives an absent signal.
const NO_VERDICT = '#e3e9ec';

const verdictFill = (verdict: MoiVerdict | null) => {
  if (!verdict) return NO_VERDICT;
  return verdict === 'no_impact_data' ? `url(#${HATCH_ID})` : VERDICT_COLOR[verdict];
};

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
  verdicts: Record<string, DayVerdict> | null,
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
      sev: entry?.p ?? 0,
      label: pending ? 'Summary in progress' : (entry?.risk_label ?? 'No data'),
      ev: emdatDates.has(key),
      pending,
      verdict: verdicts?.[key]?.verdict ?? null,
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
  showEmdat: boolean;
  verdicts: Record<string, DayVerdict> | null;
  verdictMode: boolean;
}

export function ExceedanceCalendar({
  index,
  emdatDates,
  pendingDates,
  loading,
  year,
  playing,
  showEmdat,
  verdicts,
  verdictMode,
}: Props) {
  const { selectedDate, setSelectedDate } = usePipelineStore();

  const band = useMemo(
    () => buildBand(year, index, emdatDates, pendingDates, verdicts),
    [year, index, emdatDates, pendingDates, verdicts],
  );

  return (
    <>
      <div className='pane__hd'>
        <h3 className='pane__ttl'>
          {verdictMode ? 'Daily outcome calendar' : 'Daily exceedance calendar'}
        </h3>
        <span className='pane__meta'>
          {band.year} · {band.riskDays} elevated days
          {loading ? <i className='spin inline' /> : null}
        </span>
      </div>
      <p className='pane__note'>
        {verdictMode ? (
          <>
            One cell is one day, coloured by the worst outcome recorded in any admin-1 unit. Hatched
            days have no loss record to score against.
          </>
        ) : (
          <>
            One cell is one forecast day, coloured by that day&rsquo;s worst admin-1 severity. Click
            a cell to load its regions.
          </>
        )}
      </p>
      <div className={`cal-scroll${showEmdat ? '' : ' no-emdat'}`}>
        <div id='cal'>
          <div className='year-band' id={`band-${band.year}`}>
            <svg
              className='cal-svg'
              width={band.w}
              height={band.h}
              viewBox={`0 0 ${band.w} ${band.h}`}
            >
              <MoiHatch />
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
                    fill={verdictMode ? verdictFill(c.verdict) : color(c.sev)}
                    onClick={() => setSelectedDate(c.iso)}
                  >
                    <title>
                      {verdictMode
                        ? `${c.iso} · ${c.verdict ? VERDICT_LABEL[c.verdict] : 'Nothing to score'}`
                        : `${c.iso} · ${c.label}`}
                    </title>
                  </rect>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </>
  );
}
