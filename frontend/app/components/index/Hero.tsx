'use client';

import React, { useEffect, useRef, useState } from 'react';

// Key facts shown in the running ticker.
const TICKER_ITEMS = [
  ['51', 'ensemble members'],
  ['7', 'accumulation windows · 3 h → 7 days'],
  ['6', 'return periods · 2 → 100 yr'],
  ['37', 'EM-DAT flood events'],
  ['Apr–May 2024', 'East Africa floods'],
];

export function Hero() {
  const [info, setInfo] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (
        popRef.current &&
        !popRef.current.contains(e.target as Node) &&
        e.target !== btnRef.current
      ) {
        setInfo(false);
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // Track is duplicated so the marquee loops seamlessly.
  const track = [...TICKER_ITEMS, ...TICKER_ITEMS];

  return (
    <div className='hero'>
      <div className='eyebrow'>East Africa · ECMWF IFS ensemble · Apr–May 2024</div>
      <div className='hero-title'>
        <h1>MUST Floodrisk Toolkit</h1>
        <button
          ref={btnRef}
          className={`info-btn${info ? ' on' : ''}`}
          aria-label='About this view'
          title='About this view'
          onClick={(e) => {
            e.stopPropagation();
            setInfo((v) => !v);
          }}
        >
          i
        </button>
        <div ref={popRef} className={`info-pop${info ? ' on' : ''}`}>
          Every cell is one forecast day. Colour encodes the empirical exceedance probability, the
          fraction of the 51-member ensemble signalling a flood-relevant extreme. Click any day to
          open its storymap.
        </div>
      </div>
      <p className='caption'>The April–May 2024 East Africa floods, day by day.</p>
      <div className='ticker' aria-label='Key facts'>
        <span className='ticker-badge'>
          <span className='pulse' />
        </span>
        <div className='ticker-vp'>
          <div className='ticker-track'>
            {track.map(([b, t], i) => (
              <React.Fragment key={i}>
                <span className='ti'>
                  <b>{b}</b>
                  {t}
                </span>
                <span className='sep' />
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
