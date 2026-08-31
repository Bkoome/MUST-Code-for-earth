'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { HERO_BANNERS, HERO_BANNER_INTERVAL_MS } from 'app/config';

// Key facts shown in the running ticker.
const TICKER_ITEMS: [string, string][] = [
  ['51', 'ensemble members'],
  ['7', 'accumulation windows · 3 h → 7 days'],
  ['6', 'return periods · 2 → 100 yr'],
  ['37', 'EM-DAT flood events'],
  ['Apr–May 2024', 'East Africa floods'],
];

interface Drop {
  x: number;
  y: number;
  len: number;
  v: number;
  a: number;
}

/**
 * The atmosphere zone: the MUST banner photography, cross-faded, under an ink
 * scrim that keeps the masthead legible over any frame. A light rainfall layer
 * sits on top to tie the photographs to the forecast the console below reports.
 */
export function HeroBanner() {
  const skyRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(0);
  const [calm, setCalm] = useState(false);
  const [info, setInfo] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setCalm(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Cross-fade the banner on its own; held still when the reader asks for
  // reduced motion. There is no manual control — the images are backdrop, and a
  // pager under the title read as a thing to operate.
  useEffect(() => {
    if (calm || HERO_BANNERS.length < 2) return;
    const id = window.setInterval(
      () => setActive((i) => (i + 1) % HERO_BANNERS.length),
      HERO_BANNER_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [calm]);

  // Rainfall on a canvas: cheap, and it pauses when the banner scrolls away.
  useEffect(() => {
    const sky = skyRef.current;
    const cv = canvasRef.current;
    if (!sky || !cv || calm) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let drops: Drop[] = [];
    let raf: number | null = null;

    const size = () => {
      const r = sky.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      cv.width = w * dpr;
      cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drops = Array.from({ length: Math.round(w / 11) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        len: 9 + Math.random() * 17,
        v: 4.6 + Math.random() * 6.4,
        a: 0.1 + Math.random() * 0.3,
      }));
    };

    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';
      for (const d of drops) {
        ctx.strokeStyle = `rgba(214,240,248,${d.a})`;
        ctx.lineWidth = d.a > 0.28 ? 1.2 : 0.8;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * 0.26, d.y + d.len); // slight wind lean
        ctx.stroke();
        d.y += d.v;
        d.x -= d.v * 0.26;
        if (d.y > h) {
          d.y = -d.len;
          d.x = Math.random() * w;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    size();
    window.addEventListener('resize', size);
    raf = requestAnimationFrame(tick);

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && raf === null) raf = requestAnimationFrame(tick);
        else if (!entry.isIntersecting && raf !== null) {
          cancelAnimationFrame(raf);
          raf = null;
        }
      },
      { threshold: 0 },
    );
    io.observe(sky);

    return () => {
      window.removeEventListener('resize', size);
      io.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [calm]);

  // Close the "about this view" popover on click-away.
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

  // The track is duplicated so the marquee loops seamlessly.
  const track = [...TICKER_ITEMS, ...TICKER_ITEMS];

  return (
    <section className='sky' id='top' ref={skyRef}>
      <div className='sky__shots'>
        {HERO_BANNERS.map((b, i) => {
          const on = i === active;
          return (
            <div
              key={b.src}
              className={`sky__shot${on ? ' is-on' : ''}`}
              aria-hidden={on ? undefined : true}
            >
              <Image
                src={b.src}
                alt={on ? b.alt : ''}
                fill
                priority={i === 0}
                sizes='100vw'
                quality={82}
              />
            </div>
          );
        })}
      </div>

      <div className='sky__scrim' aria-hidden='true' />
      <canvas className='rain' ref={canvasRef} aria-hidden='true' />

      <div className='shell sky__in'>
        <div className='hero'>
          <span className='eyebrow'>East Africa · ECMWF IFS ensemble · 2023–2026</span>
          <div className='hero-title'>
            <h1>
              Monitoring and Understanding
              <br />
              <em>Floodrisk Toolkit</em>
              {/* Inline, so it trails the last word. The h1 box is capped at
                  18ch and wraps well short of that cap, so a sibling flex item
                  would sit out in the leftover whitespace instead. */}
              <button
                ref={btnRef}
                className={`info-btn${info ? ' on' : ''}`}
                aria-label='About this view'
                aria-expanded={info}
                onClick={(e) => {
                  e.stopPropagation();
                  setInfo((v) => !v);
                }}
              >
                i
              </button>
            </h1>
            <div ref={popRef} className={`info-pop${info ? ' on' : ''}`}>
              Every cell in the calendar below is one forecast day. Colour encodes the empirical
              exceedance probability, the fraction of the 51-member ensemble signalling a
              flood-relevant extreme. Click any day to open its storymap.
            </div>
          </div>
          <p className='caption'>
            Daily flood-relevant exceedance across the Greater Horn of Africa, paired with recorded
            impacts — day by day.
          </p>
        </div>

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
    </section>
  );
}
