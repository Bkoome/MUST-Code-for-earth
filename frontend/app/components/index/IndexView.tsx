'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePipelineStore } from 'app/store/providers/pipeline';
import { loadCalendarIndex } from 'app/lib/api/contract';
import type { CalendarIndex } from 'app/types/contract';
import { CAL_YEARS } from 'app/types/pipeline';
import { fetchXrDates } from 'app/lib/tiles/xr-url';
import { RAMP } from 'app/lib/exceedance-ramp';
import { Hero } from './Hero';
import { Controls } from './Controls';
import { ExceedanceCalendar } from './ExceedanceCalendar';
import { MissedOpportunity } from './MissedOpportunity';
import { Choropleth } from './Choropleth';
import { DayCard } from './DayCard';
import { PlaybackBar } from './PlaybackBar';
import { usePlayback } from './usePlayback';
import { useBuilderProgress } from './useBuilderProgress';

export function IndexView() {
  const { hazard, window: win, returnPeriod, selectedDate, setSelectedDate } = usePipelineStore();
  const [index, setIndex] = useState<CalendarIndex>({});
  const [emdatDates, setEmdatDates] = useState<Set<string>>(new Set());
  const [archiveDates, setArchiveDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  // Calendar year defaults to the latest year the store actually holds.
  const [calendarYear, setCalendarYear] = useState<number>(CAL_YEARS[CAL_YEARS.length - 1]);

  // Years present in the store, from /xr/dates; falls back to CAL_YEARS until loaded.
  const years = useMemo(() => {
    const present = Array.from(new Set(archiveDates.map((d) => Number(d.slice(0, 4))))).sort(
      (a, b) => a - b,
    );
    return present.length ? present : [...CAL_YEARS];
  }, [archiveDates]);

  const progress = useBuilderProgress();
  const summarized = progress?.summarized ?? 0;

  const playback = usePlayback({
    year: calendarYear,
    query: { hazard, window: win, returnPeriod },
    selectedDate: selectedDate ?? null,
    setSelectedDate,
    summarized,
  });

  useEffect(() => {
    fetchXrDates()
      .then(setArchiveDates)
      .catch((e) => console.error('Failed to load store dates', e));
  }, []);

  // Snap to the latest available year once store dates load (or when the year has no data).
  useEffect(() => {
    if (years.length && !years.includes(calendarYear)) setCalendarYear(years[years.length - 1]);
  }, [years]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadCalendarIndex({ hazard, window: win, returnPeriod })
      .then((feed) => {
        if (cancelled) return;
        setIndex(feed.index);
        setEmdatDates(feed.emdatDates);
      })
      .catch((e) => {
        console.error('Failed to load calendar index', e);
        if (!cancelled) {
          setIndex({});
          setEmdatDates(new Set());
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [hazard, win, returnPeriod, summarized]);

  // Archive dates the builder has not summarized yet render as pending cells.
  const pendingDates = useMemo(() => {
    if (!progress) return new Set<string>();
    const done = new Set(progress.dates);
    return new Set(archiveDates.filter((d) => !done.has(d)));
  }, [archiveDates, progress]);

  // Flash a short "archive ready" chip when the builder finishes during a session.
  const complete = progress != null && progress.summarized >= progress.total;
  const wasIncomplete = useRef(false);
  const [justFinished, setJustFinished] = useState(false);
  useEffect(() => {
    if (!complete) {
      wasIncomplete.current = true;
      return;
    }
    if (wasIncomplete.current) {
      setJustFinished(true);
      const id = window.setTimeout(() => setJustFinished(false), 4000);
      return () => window.clearTimeout(id);
    }
  }, [complete]);

  const selectedEntry = useMemo(
    () => (selectedDate ? (index[selectedDate] ?? null) : null),
    [index, selectedDate],
  );

  return (
    <section className='wrap'>
      <Hero />

      <div className='panel calpanel'>
        <header>
          <div>
            <h2>Daily exceedance &amp; affected regions</h2>
            <p className='hint'>
              Each calendar cell is one forecast day · the map shows the admin-1 regions affected on
              the selected day
            </p>
          </div>
          <div className='legend'>
            {progress && !complete ? (
              <span className='prog-chip'>
                <i className='spin' /> Preparing archive {progress.summarized}/{progress.total}
              </span>
            ) : null}
            {justFinished ? <span className='prog-chip done'>Archive ready</span> : null}
            <span>low</span>
            <span className='ramp'>
              {RAMP.map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
            <span>extreme</span>
            <span className='legmatch'>
              <i /> EM-DAT match
            </span>
          </div>
        </header>

        <Controls year={calendarYear} years={years} onYearChange={setCalendarYear} />

        <PlaybackBar playback={playback} />

        <div className='widgets'>
          <div className='wcol'>
            <ExceedanceCalendar
              index={index}
              emdatDates={emdatDates}
              pendingDates={pendingDates}
              loading={loading}
              year={calendarYear}
              playing={playback.playing}
            />
            <MissedOpportunity year={calendarYear} />
          </div>
          <Choropleth cachedRegions={playback.cachedRegions} />
        </div>

        <DayCard date={selectedDate ?? null} entry={selectedEntry} />
      </div>
    </section>
  );
}
