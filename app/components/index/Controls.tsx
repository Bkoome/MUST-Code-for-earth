'use client';

import React from 'react';
import { usePipelineStore } from 'app/store/providers/pipeline';
import { ACCUM_WINDOWS, RETURN_PERIODS, CAL_YEARS } from 'app/types/pipeline';
import type { AccumWindow, ReturnPeriod } from 'app/types/pipeline';

const fmtWin = (w: string) => w.replace('h', ' h').replace('d', ' d');
const fmtRp = (rp: string) => rp.replace('yr', ' yr');

interface Props {
  year: number;
  onYearChange: (year: number) => void;
}

export function Controls({ year, onYearChange }: Props) {
  const { window: win, returnPeriod, setWindow, setReturnPeriod } = usePipelineStore();

  return (
    <div className='controls'>
      <div className='ctl'>
        <label>Accumulation window</label>
        <div className='seg sm'>
          {ACCUM_WINDOWS.map((w) => (
            <button
              key={w}
              className={w === win ? 'on' : undefined}
              onClick={() => setWindow(w as AccumWindow)}
            >
              {fmtWin(w)}
            </button>
          ))}
        </div>
      </div>
      <div className='ctl'>
        <label>Return period</label>
        <div className='seg sm'>
          {RETURN_PERIODS.map((rp) => (
            <button
              key={rp}
              className={rp === returnPeriod ? 'on' : undefined}
              onClick={() => setReturnPeriod(rp as ReturnPeriod)}
            >
              {fmtRp(rp)}
            </button>
          ))}
        </div>
      </div>
      <div className='ctl'>
        <label>Jump to year</label>
        <div className='seg sm'>
          {CAL_YEARS.map((y) => (
            <button
              key={y}
              className={y === year ? 'on' : undefined}
              onClick={() => onYearChange(y)}
            >
              {y}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
