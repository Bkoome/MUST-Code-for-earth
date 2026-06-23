'use client';

import React, { useState } from 'react';
import type { Playback, PlayScope } from './usePlayback';

const SCOPES: PlayScope[] = ['month', 'year'];

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
      <div className='playbar playbar-collapsed'>
        <span className='playbar-title'>Time-lapse playback</span>
        {cursorIndex >= 0 && <span className='play-date mono'>{current}</span>}
        <button
          className='playbar-toggle'
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-label='Show playback controls'
        >
          <span className='playbar-toggle-label'>Controls</span>
          <span className='playbar-chevron' aria-hidden>
            ▾
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className='playbar'>
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
      <span className='play-date mono'>{current}</span>
      <div className='seg sm'>
        {SCOPES.map((s) => (
          <button key={s} className={s === scope ? 'on' : undefined} onClick={() => setScope(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className='seg sm'>
        {speeds.map((s) => (
          <button key={s} className={s === speed ? 'on' : undefined} onClick={() => setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <span className='play-buf mono'>
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
