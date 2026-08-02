'use client';

import React from 'react';
import { usePipelineStore } from 'app/store/providers/pipeline';
import { ACCUM_WINDOWS, RETURN_PERIODS } from 'app/types/pipeline';
import type { AccumWindow, ReturnPeriod } from 'app/types/pipeline';

const fmtWin = (w: string) => w.replace('h', ' h').replace('d', ' d');
const fmtRp = (rp: string) => rp.replace('yr', ' yr');

interface Props {
  year: number;
  years: number[]; // years present in the store, from /xr/dates
  onYearChange: (year: number) => void;
}

export function Controls({ year, years, onYearChange }: Props) {
  const { window: win, returnPeriod, setWindow, setReturnPeriod } = usePipelineStore();

  return (
    <div className='controls'>
      <div className='ctl'>
        <label htmlFor='ctl-window'>Accumulation window</label>
        <select
          id='ctl-window'
          className='ctl-select'
          value={win}
          onChange={(e) => setWindow(e.target.value as AccumWindow)}
        >
          {ACCUM_WINDOWS.map((w) => (
            <option key={w} value={w}>
              {fmtWin(w)}
            </option>
          ))}
        </select>
      </div>
      <div className='ctl'>
        <label htmlFor='ctl-rp'>Return period</label>
        <select
          id='ctl-rp'
          className='ctl-select'
          value={returnPeriod}
          onChange={(e) => setReturnPeriod(e.target.value as ReturnPeriod)}
        >
          {RETURN_PERIODS.map((rp) => (
            <option key={rp} value={rp}>
              {fmtRp(rp)}
            </option>
          ))}
        </select>
      </div>
      <div className='ctl'>
        <label htmlFor='ctl-year'>Jump to year</label>
        <select
          id='ctl-year'
          className='ctl-select'
          value={year}
          onChange={(e) => onYearChange(Number(e.target.value))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
