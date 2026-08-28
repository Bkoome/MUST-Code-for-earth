'use client';

import React from 'react';
import { usePipelineStore } from 'app/store/providers/pipeline';
import type { CalendarIndexEntry } from 'app/types/contract';
import { RISK_COLOR } from 'app/types/contract';

const fmtWin = (w: string) => w.replace('h', ' h').replace('d', ' d');
const fmtRp = (rp: string) => rp.replace('yr', ' yr');

const prettyDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

interface Props {
  date: string | null;
  entry: CalendarIndexEntry | null;
}

export function DayCard({ date, entry }: Props) {
  const { window: win, returnPeriod, openStory } = usePipelineStore();

  if (!date || !entry) {
    return (
      <div className='day day--empty'>
        <strong>Select a day</strong> in the calendar to see its worst admin-1 risk class, the
        number of ensemble members over threshold and a link into that day&rsquo;s storymap.
      </div>
    );
  }

  const accent = RISK_COLOR[entry.worst_risk];

  return (
    <div className='day'>
      {/* Three bands on one line — subject, readings, way out — so the slab
          spans the full deck width instead of bunching against its left edge. */}
      <div className='day__id'>
        <p className='day__date'>
          {date}
          <span
            className='day__tag'
            style={{ background: accent, color: entry.worst_risk >= 2 ? '#fff' : '#0a1e26' }}
          >
            {entry.risk_label}
          </span>
        </p>
        <p className='day__sub'>
          {fmtWin(win)} window · return period ≥ {fmtRp(returnPeriod)} · East Africa
        </p>
      </div>
      <div className='stats'>
        <div className='stat'>
          <b>{entry.risk_label}</b>
          <span>Worst admin-1 severity</span>
        </div>
        <div className='stat'>
          <b>{entry.n_units}</b>
          <span>Ensemble members</span>
        </div>
        <div className='stat'>
          <b>{fmtWin(win)}</b>
          <span>Window</span>
        </div>
        <div className='stat'>
          <b>{fmtRp(returnPeriod)}</b>
          <span>Return period</span>
        </div>
      </div>
      <button className='btn btn--solid day__cta' onClick={() => openStory(date)}>
        Open the {prettyDate(date)} storymap →
      </button>
    </div>
  );
}
