'use client';

import React from 'react';
import { usePipelineStore } from 'app/store/providers/pipeline';
import type { CalendarIndexEntry } from 'app/types/contract';
import { RISK_COLOR } from 'app/types/contract';

const fmtWin = (w: string) => w.replace('h', ' h').replace('d', ' d');
const fmtRp = (rp: string) => rp.replace('yr', ' yr');

interface Props {
  date: string | null;
  entry: CalendarIndexEntry | null;
}

export function DayCard({ date, entry }: Props) {
  const { window: win, returnPeriod, openStory } = usePipelineStore();

  if (!date || !entry) {
    return (
      <div className='daycard'>
        <div className='empty'>
          <strong>Select a day</strong> in the calendar to see its worst admin-1 risk class, the
          number of regions affected and a link into the per-day storymap.
        </div>
      </div>
    );
  }

  const accent = RISK_COLOR[entry.worst_risk];

  return (
    <div className='daycard'>
      <div className='dc-head'>
        <span className='dc-date'>{date}</span>
        <span className='pill' style={{ background: `${accent}22`, color: accent }}>
          {entry.risk_label}
        </span>
      </div>
      <p className='dc-sub'>
        {fmtWin(win)} window · return period ≥ {fmtRp(returnPeriod)} · East Africa
      </p>
      <div className='dc-stats'>
        <div>
          <b>{entry.risk_label}</b>
          <span>worst admin-1 severity</span>
        </div>
        <div>
          <b>{entry.n_units}</b>
          <span>regions assessed</span>
        </div>
        <div>
          <b>{fmtWin(win)}</b>
          <span>window</span>
        </div>
        <div>
          <b>{fmtRp(returnPeriod)}</b>
          <span>return period</span>
        </div>
      </div>
      <div className='dc-actions'>
        <button className='btn-primary' onClick={() => openStory(date)}>
          Open {date} storymap →
        </button>
      </div>
    </div>
  );
}
