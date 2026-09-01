'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { usePipelineStore } from 'app/store/providers/pipeline';

type DropId = 'about' | 'partners' | null;

// The rail sits over the hero banner and only goes opaque once the banner has
// scrolled past, so the flood reads through it at the top of the page.
const STUCK_AFTER = 220;

export function TopBar() {
  const { view, setView } = usePipelineStore();
  const [open, setOpen] = useState<DropId>(null);
  const [drawer, setDrawer] = useState(false);
  const [stuck, setStuck] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  const onIndex = view === 'index';

  // The story view has no banner behind the rail, so it is always opaque there.
  useEffect(() => {
    if (!onIndex) {
      setStuck(true);
      return;
    }
    const onScroll = () => setStuck(window.scrollY > STUCK_AFTER);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [onIndex]);

  // Close dropdowns and the drawer on click-away + Esc.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(null);
      setDrawer(false);
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

  const close = useCallback(() => {
    setOpen(null);
    setDrawer(false);
  }, []);

  const goIndex = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      close();
      setView('index');
    },
    [close, setView],
  );

  const goStory = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      close();
      setView('story');
    },
    [close, setView],
  );

  return (
    <>
      <header className={`rail${stuck ? ' is-stuck' : ''}`}>
        <div className='rail__in'>
          <button className='mark' onClick={goIndex} aria-label='MUST home'>
            {/* The logo is a white-background JPG, so it sits on its own light
                plate rather than showing a white box against the dark rail. */}
            <span className='mark__plate'>
              <Image
                className='mark__logo'
                src='/must-banner.jpg'
                alt='MUST: Monitoring and Understanding SpatioTemporal Flood Risk Toolkit'
                width={44}
                height={40}
                priority
              />
            </span>
            <span className='mark__txt'>
              <span className='mark__name'>MUST</span>
              <span className='mark__sub'>Floodrisk Toolkit</span>
            </span>
          </button>

          <nav className='nav' aria-label='Primary' ref={navRef}>
            <a
              className={`navitem${onIndex ? ' on' : ''}`}
              id='nav-home'
              href='#top'
              onClick={goIndex}
            >
              Home
            </a>

            <a
              className={`navitem${view === 'story' ? ' on' : ''}`}
              id='nav-stories'
              href='#'
              onClick={goStory}
            >
              Storymaps
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
                  <b>monitoring and understanding spatiotemporal flood risk</b> across East Africa.
                  It turns ECMWF IFS ensemble forecasts into daily exceedance-probability fields and
                  pairs them with recorded impacts so analysts and duty officers can see risk
                  evolve, day by day.
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
                      <b>Impact verification</b>: forecast signals cross-referenced against EM-DAT
                      flood records.
                    </span>
                  </li>
                  <li>
                    <span className='dd-dot' />
                    <span>
                      <b>Per-day storymaps</b>: bespoke scrollytelling that walks each event from
                      signal to impact.
                    </span>
                  </li>
                </ul>
              </div>
            </div>

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
                  This space will list the organisations and institutions collaborating on MUST:
                  partner logos, roles and links will be populated here.
                </p>
                <p>
                  Interested in contributing data, compute or expertise? Partner details are on the
                  way.
                </p>
              </div>
            </div>
          </nav>

          <button
            className='burger'
            aria-expanded={drawer}
            aria-controls='drawer'
            aria-label={drawer ? 'Close menu' : 'Open menu'}
            onClick={(e) => {
              e.stopPropagation();
              setDrawer((v) => !v);
            }}
          >
            <svg width='20' height='14' viewBox='0 0 20 14' aria-hidden='true'>
              <path d='M0 1h20M0 7h20M0 13h20' stroke='currentColor' strokeWidth='1.6' />
            </svg>
          </button>
        </div>
      </header>

      <nav className={`drawer${drawer ? ' open' : ''}`} id='drawer' aria-label='Mobile'>
        <button onClick={goIndex}>Home</button>
        <button onClick={goStory}>Storymaps</button>
        <p className='drawer__note'>
          About and Partners are available on wider screens; both sections are also linked from the
          footer.
        </p>
      </nav>
    </>
  );
}
