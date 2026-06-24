'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { usePipelineStore } from 'app/store/providers/pipeline';

type DropId = 'about' | 'partners' | null;

export function TopBar() {
  const { view, setView } = usePipelineStore();
  const [open, setOpen] = useState<DropId>(null);
  const navRef = useRef<HTMLElement>(null);

  // Close dropdowns on click-away + Esc.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const toggle = (id: Exclude<DropId, null>) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((cur) => (cur === id ? null : id));
  };

  const goIndex = (e: React.MouseEvent) => {
    e.preventDefault();
    setOpen(null);
    setView('index');
  };
  const goStory = (e: React.MouseEvent) => {
    e.preventDefault();
    setOpen(null);
    setView('story');
  };

  const onIndex = view === 'index';

  return (
    <div className='topbar'>
      <button className='brand' onClick={goIndex} aria-label='MUST home'>
        <Image
          className='brand-logo'
          src='/must-banner.jpg'
          alt='MUST: Monitoring & Understanding SpatioTemporal Flood Risk Toolkit'
          width={53}
          height={48}
          priority
        />
      </button>

      <nav className='nav' aria-label='Primary' ref={navRef}>
        <a
          className={`navitem${onIndex ? ' on' : ''}`}
          id='nav-home'
          href='#'
          onClick={goIndex}
          title='Home'
        >
          <svg
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={2}
            strokeLinecap='round'
            strokeLinejoin='round'
            aria-hidden='true'
          >
            <path d='M3 10.5 12 3l9 7.5' />
            <path d='M5 9.3V21h5v-6h4v6h5V9.3' />
          </svg>
          <span>Home</span>
        </a>

        <div className='navitem-wrap'>
          <button
            className={`navitem${open === 'about' ? ' open' : ''}`}
            id='nav-about'
            aria-haspopup='dialog'
            aria-expanded={open === 'about'}
            onClick={toggle('about')}
          >
            About <span className='caret' />
          </button>
          <div
            className={`dropdown${open === 'about' ? ' on' : ''}`}
            id='dd-about'
            role='dialog'
            aria-label='About MUST'
          >
            <div className='dd-eyebrow'>About the toolkit</div>
            <h4>What is MUST?</h4>
            <p>
              MUST is an open toolkit for{' '}
              <b>monitoring and understanding spatiotemporal flood risk</b> across East Africa. It
              turns ECMWF IFS ensemble forecasts into daily exceedance-probability fields and pairs
              them with recorded impacts so analysts and duty officers can see risk evolve, day by
              day.
            </p>
            <ul className='dd-feats'>
              <li>
                <span className='dd-dot' />
                <span>
                  <b>Ensemble exceedance</b>: 51-member IFS, 7 accumulation windows, 6 return
                  periods.
                </span>
              </li>
              <li>
                <span className='dd-dot' />
                <span>
                  <b>Impact verification</b>: forecast signals cross-referenced against EM-DAT flood
                  records.
                </span>
              </li>
              <li>
                <span className='dd-dot' />
                <span>
                  <b>Per-day storymaps</b>: bespoke scrollytelling that walks each event from signal
                  to impact.
                </span>
              </li>
            </ul>
          </div>
        </div>

        <a className='navitem' id='nav-events' href='#' onClick={goIndex}>
          Events
        </a>
        <a
          className={`navitem${view === 'story' ? ' on' : ''}`}
          id='nav-stories'
          href='#'
          onClick={goStory}
        >
          Storylines
        </a>

        <div className='navitem-wrap'>
          <button
            className={`navitem${open === 'partners' ? ' open' : ''}`}
            id='nav-partners'
            aria-haspopup='dialog'
            aria-expanded={open === 'partners'}
            onClick={toggle('partners')}
          >
            Partners <span className='caret' />
          </button>
          <div
            className={`dropdown${open === 'partners' ? ' on' : ''}`}
            id='dd-partners'
            role='dialog'
            aria-label='Partners'
          >
            <span className='soon'>Coming soon</span>
            <h4>Partners &amp; collaborators</h4>
            <p>
              This space will list the organisations and institutions collaborating on MUST: partner
              logos, roles and links will be populated here.
            </p>
            <p>
              Interested in contributing data, compute or expertise? Partner details are on the way.
            </p>
          </div>
        </div>
      </nav>

      <div className='cfe'>
        <span className='dot' />
        Code&nbsp;for&nbsp;Earth · 2026
      </div>
    </div>
  );
}
