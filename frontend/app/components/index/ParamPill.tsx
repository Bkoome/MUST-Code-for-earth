'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePipelineStore } from 'app/store/providers/pipeline';
import { ACCUM_WINDOWS, RETURN_PERIODS } from 'app/types/pipeline';
import type { AccumWindow, ReturnPeriod } from 'app/types/pipeline';

const fmtWin = (w: string) => w.replace('h', ' h').replace('d', ' d');
const fmtRp = (rp: string) => rp.replace('yr', ' yr');

interface Props {
  year: number;
  years: number[]; // the whole archive span, browsable whether ingested or not
  yearsWithData: Set<number>; // the subset the store actually holds dates for
  onYearChange: (year: number) => void;
}

/**
 * One pill summarising the whole query, opening a popover of segmented
 * controls. It replaces three separate selects: the summary stays readable
 * while the console is in use, and every option is visible at once when open.
 */
export function ParamPill({ year, years, yearsWithData, onYearChange }: Props) {
  const { window: win, returnPeriod, setWindow, setReturnPeriod } = usePipelineStore();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className='params' ref={wrapRef}>
      <button
        className='parampill'
        aria-expanded={open}
        aria-controls='param-pop'
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <span className='parampill__k'>Window</span>
        <b>{fmtWin(win)}</b>
        <i />
        <span className='parampill__k'>Return</span>
        <b>{fmtRp(returnPeriod)}</b>
        <i />
        <span className='parampill__k'>Year</span>
        <b>{year}</b>
        <svg className='parampill__cv' width='9' height='6' viewBox='0 0 9 6' aria-hidden='true'>
          <path
            d='M1 1l3.5 3.5L8 1'
            stroke='currentColor'
            strokeWidth='1.4'
            fill='none'
            strokeLinecap='round'
          />
        </svg>
      </button>

      {open ? (
        <div className='pop' id='param-pop'>
          <div className='ctrl'>
            <span className='ctrl__lbl' id='lbl-win'>
              Accumulation window
            </span>
            <div className='seg' role='group' aria-labelledby='lbl-win'>
              {ACCUM_WINDOWS.map((w) => (
                <button
                  key={w}
                  className={w === win ? 'on' : undefined}
                  aria-pressed={w === win}
                  onClick={() => setWindow(w as AccumWindow)}
                >
                  {fmtWin(w)}
                </button>
              ))}
            </div>
          </div>

          <div className='ctrl'>
            <span className='ctrl__lbl' id='lbl-rp'>
              Return period
            </span>
            <div className='seg' role='group' aria-labelledby='lbl-rp'>
              {RETURN_PERIODS.map((rp) => (
                <button
                  key={rp}
                  className={rp === returnPeriod ? 'on' : undefined}
                  aria-pressed={rp === returnPeriod}
                  onClick={() => setReturnPeriod(rp as ReturnPeriod)}
                >
                  {fmtRp(rp)}
                </button>
              ))}
            </div>
          </div>

          <div className='ctrl'>
            <span className='ctrl__lbl' id='lbl-yr'>
              Year
            </span>
            <div className='seg' role='group' aria-labelledby='lbl-yr'>
              {years.map((y) => {
                const has = yearsWithData.has(y);
                return (
                  <button
                    key={y}
                    className={[y === year ? 'on' : '', has ? '' : 'empty']
                      .filter(Boolean)
                      .join(' ')}
                    aria-pressed={y === year}
                    title={has ? undefined : `${y} is not in the archive yet`}
                    onClick={() => onYearChange(y)}
                  >
                    {y}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
