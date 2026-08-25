'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePipelineStore } from 'app/store/providers/pipeline';
import { fetchXrDates } from 'app/lib/tiles/xr-url';
import { fetchStoryData, windowHours, rpYears, type StoryData } from 'app/lib/story/data';
import { fetchEnsemble, fetchExceedanceCalendar } from 'app/lib/api/exceedance';
import { loadAdm1, type Adm1Collection } from 'app/lib/story/camera';
import { severityLabel } from 'app/lib/story/narrative';
import type { EnsembleTrajectory } from 'app/types/exceedance';
import { buildStory } from './storyConfig';
import { StoryMap } from './StoryMap';
import { StoryTop } from './StoryTop';
import { Chapter } from './Chapter';

const PENDING_RETRY_MS = 5000;

// Which day to tell. The archive has gaps, so a requested day that it does not
// hold snaps to the nearest day it does rather than to an arbitrary edge; with
// no day requested at all, open on the strongest day on record.
function resolveDate(want: string | null, days: { date: string; p: number }[]): string | null {
  if (days.length === 0) return want;
  if (!want) return days.reduce((a, b) => (b.p > a.p ? b : a)).date;
  const target = Date.parse(want);
  let best = days[0].date;
  let bestGap = Infinity;
  for (const d of days) {
    if (d.date === want) return want;
    const gap = Math.abs(Date.parse(d.date) - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = d.date;
    }
  }
  return best;
}

export function ScrollyStory() {
  const { selectedDate, window: win, returnPeriod, hazard } = usePipelineStore();

  // Snap to the summarized archive — every day the calendar offers — not to the
  // store's init dates. The store only holds the raw fields of a short recent
  // window, while summaries cover the whole archive, so clamping to the store
  // used to collapse every storyline onto the same trailing day.
  const [archive, setArchive] = useState<{ date: string; p: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchExceedanceCalendar({ hazard, window: win, returnPeriod })
      .then((days) => {
        if (!cancelled) setArchive(days.map((d) => ({ date: d.date, p: d.p })));
      })
      .catch((err) => console.warn('[storymap] calendar failed:', err));
    return () => {
      cancelled = true;
    };
  }, [hazard, win, returnPeriod]);

  // The raw member fields the raster layers need live only for the store's own
  // dates; the rest of the story is served from summaries either way.
  const [xrDates, setXrDates] = useState<string[] | null>(null);
  useEffect(() => {
    fetchXrDates()
      .then(setXrDates)
      .catch((err) => console.warn('[storymap] /xr/dates failed:', err));
  }, []);

  const date = resolveDate(selectedDate ?? null, archive);
  const fieldsAvailable = !date || !xrDates ? true : xrDates.includes(date);

  // The story follows the forecast: data + admin-1 geometry drive the chapters.
  const [data, setData] = useState<StoryData | null>(null);
  const [adm1, setAdm1] = useState<Adm1Collection | null>(null);
  const [pending, setPending] = useState(false);
  const [ensemble, setEnsemble] = useState<EnsembleTrajectory | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    setData(null);
    if (!date) return; // still resolving which day to tell
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
    if (!date || !fieldsAvailable) return; // the plume is derived from the raw fields
    fetchEnsemble(date, { hazard, window: win, returnPeriod })
      .then((e) => {
        if (!cancelled) setEnsemble(e);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [date, fieldsAvailable, win, returnPeriod, hazard]);

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
    // Catalogue footprint first: it spans every source, so it shades days the
    // EM-DAT-only feed left blank.
    const recorded = data?.catalogue?.gids?.length
      ? data.catalogue.gids
      : data?.emdat?.all_gids?.length
        ? data.emdat.all_gids
        : data?.emdat?.gids;
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

  if (!data || !date) {
    return (
      <section className='story'>
        <StoryTop date={date ?? '—'} severity={severity} />
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
            fieldsAvailable={fieldsAvailable}
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
