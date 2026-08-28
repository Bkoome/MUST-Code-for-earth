'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePipelineStore } from 'app/store/providers/pipeline';
import { loadCalendarIndex } from 'app/lib/api/contract';
import { fetchMoi, fetchMoiDay } from 'app/lib/api/moi';
import type { CalendarIndex } from 'app/types/contract';
import type { MoiFeed, MoiUnit, MoiVerdict } from 'app/types/moi';
import { VERDICT_ORDER } from 'app/types/moi';
import { CAL_YEARS } from 'app/types/pipeline';
import { fetchXrDates } from 'app/lib/tiles/xr-url';
import { RAMP } from 'app/lib/exceedance-ramp';
import { HeroBanner } from './HeroBanner';
import { ParamPill } from './ParamPill';
import { ExceedanceCalendar } from './ExceedanceCalendar';
import { MissedOpportunity } from './MissedOpportunity';
import { Choropleth } from './Choropleth';
import { DayCard } from './DayCard';
import { PlaybackBar } from './PlaybackBar';
import { Storylines } from './Storylines';
import { RecordedEvents } from './RecordedEvents';
import { usePlayback } from './usePlayback';
import { useBuilderProgress } from './useBuilderProgress';

const CONSOLE_ID = 'console';

export function IndexView() {
  const { hazard, window: win, returnPeriod, selectedDate, setSelectedDate } = usePipelineStore();
  const [index, setIndex] = useState<CalendarIndex>({});
  const [emdatDates, setEmdatDates] = useState<Set<string>>(new Set());
  const [archiveDates, setArchiveDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  // Calendar year; snapped below to the latest year holding data.
  const [calendarYear, setCalendarYear] = useState<number>(() =>
    selectedDate ? Number(selectedDate.slice(0, 4)) : CAL_YEARS[CAL_YEARS.length - 1],
  );
  // EM-DAT rings on the calendar; on by default, off when they crowd the ramp.
  const [showEmdat, setShowEmdat] = useState(true);
  // The evaluation, and whether the calendar and map paint verdicts instead of probability.
  const [moi, setMoi] = useState<MoiFeed | null>(null);
  const [moiLoading, setMoiLoading] = useState(false);
  const [moiUnits, setMoiUnits] = useState<MoiUnit[]>([]);
  const [verdictMode, setVerdictMode] = useState(false);
  // Once the reader picks a year, stop auto-snapping it out from under them.
  const yearPicked = useRef(false);

  // Years the store actually holds dates for, from /xr/dates.
  const yearsWithData = useMemo(
    () => new Set(archiveDates.map((d) => Number(d.slice(0, 4)))),
    [archiveDates],
  );

  // Offer the whole archive span, not only the years already ingested, so the
  // calendar stays browsable while the store fills in. Anything the store holds
  // outside that span is folded in too.
  const years = useMemo(() => {
    const all = new Set<number>(CAL_YEARS);
    yearsWithData.forEach((y) => all.add(y));
    return Array.from(all).sort((a, b) => a - b);
  }, [yearsWithData]);

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

  // Open on the latest year that actually holds data: the span runs to the
  // current year, which is usually still empty. A reader's own choice wins.
  //
  // A selected day outranks both. This view unmounts while the storymap is open,
  // so without it every return trip would re-snap to the latest year and strand
  // the reader away from the day they were just reading about.
  useEffect(() => {
    if (yearPicked.current) return;
    if (selectedDate) {
      setCalendarYear(Number(selectedDate.slice(0, 4)));
      return;
    }
    if (!yearsWithData.size) return;
    const latest = Math.max.apply(null, Array.from(yearsWithData));
    setCalendarYear((cur) => (yearsWithData.has(cur) ? cur : latest));
  }, [yearsWithData, selectedDate]);

  const chooseYear = (year: number) => {
    yearPicked.current = true;
    setCalendarYear(year);
  };

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

  // The year's verdicts and the panel's three reads arrive together, keyed on the pill.
  useEffect(() => {
    let cancelled = false;
    setMoiLoading(true);
    fetchMoi(returnPeriod, calendarYear)
      .then((feed) => !cancelled && setMoi(feed))
      .catch((e) => {
        console.error('Failed to load the missed-opportunity feed', e);
        if (!cancelled) setMoi(null);
      })
      .finally(() => !cancelled && setMoiLoading(false));
    return () => {
      cancelled = true;
    };
  }, [returnPeriod, calendarYear]);

  // One day fetch feeds three consumers: the map fill, the day slab and the event ledger.
  useEffect(() => {
    if (!selectedDate) {
      setMoiUnits([]);
      return;
    }
    let cancelled = false;
    fetchMoiDay(selectedDate, returnPeriod)
      .then((day) => !cancelled && setMoiUnits(day?.data ?? []))
      .catch((e) => {
        console.error('Failed to load day verdicts', e);
        if (!cancelled) setMoiUnits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, returnPeriod]);

  // Worst verdict per recorded event, since one event can touch units that disagree.
  const eventVerdicts = useMemo(() => {
    const worst = new Map<number, MoiVerdict>();
    for (const unit of moiUnits) {
      if (!unit.event) continue;
      const held = worst.get(unit.event.event_id);
      if (!held || VERDICT_ORDER.indexOf(unit.verdict) < VERDICT_ORDER.indexOf(held)) {
        worst.set(unit.event.event_id, unit.verdict);
      }
    }
    return worst;
  }, [moiUnits]);

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
    <>
      <HeroBanner />

      <section className='ground' id={CONSOLE_ID}>
        <div className='shell'>
          {/* The deck: the console and the recorded-event ledger side by side on a
              wide screen, the day slab spanning beneath them. Below the deck
              breakpoint the three stack in reading order instead. */}
          <div className='deck'>
            {/* One console: parameters, calendar, map and playback on a single
              widget, so a change of query is visibly one act. */}
            <div className='console'>
              <div className='cbar'>
                <ParamPill
                  year={calendarYear}
                  years={years}
                  yearsWithData={yearsWithData}
                  onYearChange={chooseYear}
                />

                <div className='cbar__end'>
                  {progress && !complete ? (
                    <span className='prog-chip'>
                      <i className='spin' /> Preparing archive {progress.summarized}/
                      {progress.total}
                    </span>
                  ) : null}
                  {justFinished ? <span className='prog-chip done'>Archive ready</span> : null}

                  <label className='emtoggle'>
                    <input
                      type='checkbox'
                      checked={showEmdat}
                      onChange={(e) => setShowEmdat(e.target.checked)}
                    />
                    <span>EM-DAT match</span>
                  </label>

                  {moi ? (
                    <label className='emtoggle'>
                      <input
                        type='checkbox'
                        checked={verdictMode}
                        onChange={(e) => setVerdictMode(e.target.checked)}
                      />
                      <span>Verdicts</span>
                    </label>
                  ) : null}

                  <div className='legend'>
                    <span>Low</span>
                    <span className='ramp' aria-hidden='true'>
                      {RAMP.map((c) => (
                        <i key={c} style={{ background: c }} />
                      ))}
                    </span>
                    <span>Extreme</span>
                  </div>
                </div>
              </div>

              <div className='panes'>
                <div className='pane'>
                  <ExceedanceCalendar
                    index={index}
                    emdatDates={emdatDates}
                    pendingDates={pendingDates}
                    loading={loading}
                    year={calendarYear}
                    playing={playback.playing}
                    showEmdat={showEmdat}
                    verdicts={moi?.days ?? null}
                    verdictMode={verdictMode}
                  />
                  <MissedOpportunity year={calendarYear} feed={moi} loading={moiLoading} />
                </div>

                <div className='pane pane--map'>
                  <Choropleth
                    cachedRegions={playback.cachedRegions}
                    verdictUnits={moiUnits}
                    verdictMode={verdictMode}
                  />
                </div>
              </div>

              <PlaybackBar playback={playback} />
            </div>

            <DayCard date={selectedDate ?? null} entry={selectedEntry} units={moiUnits} />

            {/* The forecast signal and the recorded outcome in one glance: the
              comparison the whole toolkit exists to make. */}
            <RecordedEvents date={selectedDate ?? null} verdicts={eventVerdicts} />
          </div>
        </div>
      </section>

      <Storylines index={index} emdatDates={emdatDates} />
    </>
  );
}
