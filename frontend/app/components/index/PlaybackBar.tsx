'use client';

import React, { useState } from 'react';
import type { Playback, PlayScope } from './usePlayback';

const SCOPES: PlayScope[] = ['month', 'year'];

// The bottom line of the console: playback lives on the same widget as the
// calendar and map it drives.
export function PlaybackBar({ playback }: { playback: Playback }) {
  const {
    playing,
    toggle,
    scope,
    setScope,
    speed,
    setSpeed,
    speeds,
    sequence,
    cursorIndex,
    seek,
    buffered,
  } = playback;
  const total = sequence.length;
  const current = cursorIndex >= 0 ? sequence[cursorIndex] : '—';
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className='cfoot'>
        <span className='playbar-title'>Time-lapse playback</span>
        {cursorIndex >= 0 ? <span className='play-date'>{current}</span> : null}
        <button
          className='playbar-toggle'
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-label='Show playback controls'
        >
          <span>Controls</span>
          <span className='playbar-chevron' aria-hidden>
            ▾
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className='cfoot'>
      <button className='play-btn' onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        type='range'
        className='play-scrub'
        min={0}
        max={Math.max(0, total - 1)}
        value={cursorIndex < 0 ? 0 : cursorIndex}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label='Scrub day'
      />
      <span className='play-date'>{current}</span>
      <div className='seg' role='group' aria-label='Playback scope'>
        {SCOPES.map((s) => (
          <button
            key={s}
            className={s === scope ? 'on' : undefined}
            aria-pressed={s === scope}
            onClick={() => setScope(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <div className='seg' role='group' aria-label='Playback speed'>
        {speeds.map((s) => (
          <button
            key={s}
            className={s === speed ? 'on' : undefined}
            aria-pressed={s === speed}
            onClick={() => setSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>
      <span className='play-buf'>
        {buffered}/{total}
      </span>
      <button
        className='playbar-toggle'
        onClick={() => setOpen(false)}
        aria-expanded
        aria-label='Hide playback controls'
      >
        <span className='playbar-chevron open' aria-hidden>
          ▾
        </span>
      </button>
    </div>
  );
}
