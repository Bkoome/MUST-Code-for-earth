'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePipelineStore } from 'app/store/providers/pipeline';
import { fetchXrDates } from 'app/lib/tiles/xr-url';
import { fetchStoryData, windowHours, rpYears, type StoryData } from 'app/lib/story/data';
import { fetchEnsemble } from 'app/lib/api/exceedance';
import { loadAdm1, type Adm1Collection } from 'app/lib/story/camera';
import { severityLabel } from 'app/lib/story/narrative';
import type { EnsembleTrajectory } from 'app/types/exceedance';
import { buildStory } from './storyConfig';
import { StoryMap } from './StoryMap';
import { StoryTop } from './StoryTop';
import { Chapter } from './Chapter';

// Fallback day used when arriving at the storymap without a selected date.
const DEFAULT_DATE = '2026-03-04';
const PENDING_RETRY_MS = 5000;

export function ScrollyStory() {
  const { selectedDate, window: win, returnPeriod, hazard } = usePipelineStore();
  // Clamp to store init dates so the storymap never requests a day the store lacks.
  const [xrDates, setXrDates] = useState<string[] | null>(null);
  useEffect(() => {
    fetchXrDates()
      .then(setXrDates)
      .catch((err) => console.warn('[storymap] /xr/dates failed:', err));
  }, []);
  const requested = selectedDate ?? DEFAULT_DATE;
  const date =
    xrDates?.length && !xrDates.includes(requested) ? xrDates[xrDates.length - 1] : requested;

  // The story follows the forecast: data + admin-1 geometry drive the chapters.
  const [data, setData] = useState<StoryData | null>(null);
  const [adm1, setAdm1] = useState<Adm1Collection | null>(null);
  const [pending, setPending] = useState(false);
  const [ensemble, setEnsemble] = useState<EnsembleTrajectory | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    setData(null);
    const load = () => {
      Promise.all([fetchStoryData(date, { hazard, window: win, returnPeriod }), loadAdm1()])
        .then(([result, fc]) => {
          if (cancelled) return;
          setAdm1(fc);
          if (result === 'pending') {
            setPending(true);
            timer = window.setTimeout(load, PENDING_RETRY_MS);
            return;
          }
          setPending(false);
          setData(result);
        })
        .catch((err) => console.error('[storymap] story data failed:', err));
    };
    load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [date, win, returnPeriod, hazard]);

  // The ensemble plume loads on its own track: it derives a full-horizon column server-side,
  // so it must never block the story from rendering if it is slow or unavailable.
  useEffect(() => {
    let cancelled = false;
    setEnsemble(null);
    fetchEnsemble(date, { hazard, window: win, returnPeriod })
      .then((e) => {
        if (!cancelled) setEnsemble(e);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [date, win, returnPeriod, hazard]);

  // Merge the async plume into the story data the chapters read; buildStory stays pure.
  const storyData = useMemo(() => (data ? { ...data, ensemble } : null), [data, ensemble]);
  const chapters = useMemo(
    () => (storyData && adm1 ? buildStory(storyData, adm1) : []),
    [storyData, adm1],
  );
  const regionP = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of data?.regions ?? []) out[r.shapeID] = r.p;
    return out;
  }, [data]);
  // EM-DAT layer highlights every recorded event's regions; top forecast regions as fallback.
  const highlightGids = useMemo(() => {
    const recorded = data?.emdat?.all_gids?.length ? data.emdat.all_gids : data?.emdat?.gids;
    return recorded?.length ? recorded : (data?.topRegions ?? []).map((r) => r.shapeID);
  }, [data]);

  const [activeIndex, setActiveIndex] = useState(0);
  const chapterRefs = useRef<(HTMLDivElement | null)[]>([]);
  const bgLayersRef = useRef<(HTMLDivElement | null)[]>([]);
  const frontRef = useRef(0);
  const curBgRef = useRef('');

  // Crossfade the pinned backdrop to the active chapter's image.
  const setChapterBg = (bg: string) => {
    const layers = bgLayersRef.current;
    if (layers.length < 2 || !bg || bg === curBgRef.current) return;
    curBgRef.current = bg;
    const back = layers[frontRef.current ^ 1];
    const front = layers[frontRef.current];
    if (back) {
      back.style.backgroundImage = `url(${bg})`;
      back.classList.add('on');
    }
    if (front) front.classList.remove('on');
    frontRef.current ^= 1;
  };

  // IntersectionObserver scrollytelling: the active chapter drives map + backdrop.
  useEffect(() => {
    if (chapters.length === 0) return;
    setChapterBg(chapters[0].bg);
    const els = chapterRefs.current.filter(Boolean) as HTMLDivElement[];
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting && en.intersectionRatio > 0.5) {
            const idx = els.indexOf(en.target as HTMLDivElement);
            if (idx >= 0) {
              setActiveIndex(idx);
              setChapterBg(chapters[idx].bg);
            }
          }
        });
      },
      { threshold: [0.5], rootMargin: '-10% 0px -40% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters]);

  const severity = data ? `${severityLabel(data.p)} · ${Math.round(data.p * 100)}% exceedance` : '';

  if (!data) {
    return (
      <section className='story'>
        <StoryTop date={date} severity={severity} />
        <div className='story-wait'>
          <i className='spin' />
          {pending
            ? 'Preparing this forecast on the server; the first pass takes about a minute.'
            : 'Loading forecast data'}
        </div>
      </section>
    );
  }

  return (
    <section className='story'>
      <StoryTop date={date} severity={severity} />

      <div className='scrolly'>
        <div className='pin'>
          {/* keyed by story inputs: the map mounts once per forecast and window */}
          <StoryMap
            key={`${date}|${win}|${returnPeriod}`}
            active={chapters[activeIndex] ?? null}
            date={date}
            windowH={windowHours(win)}
            rp={rpYears(returnPeriod)}
            regionP={regionP}
            highlightGids={highlightGids}
          />
        </div>

        <div className='chapters'>
          <div className='chapter-bg'>
            <div className='cbg-layer' ref={(el) => (bgLayersRef.current[0] = el)} />
            <div className='cbg-layer' ref={(el) => (bgLayersRef.current[1] = el)} />
            <div className='shade' />
          </div>

          {chapters.map((c, i) => (
            <Chapter
              key={c.id}
              config={c}
              isActive={i === activeIndex}
              ref={(el) => (chapterRefs.current[i] = el)}
            />
          ))}
        </div>
      </div>

      <footer>MUST · Code for Earth 2026 · per-day storymap · {date}</footer>
    </section>
  );
}
