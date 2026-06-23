'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { usePipelineStore } from 'app/store/providers/pipeline';
import { loadCalendarIndex } from 'app/lib/api/contract';
import type { CalendarIndex } from 'app/types/contract';
import { CAL_YEARS } from 'app/types/pipeline';
import { RAMP } from 'app/lib/exceedance-ramp';
import { Hero } from './Hero';
import { Controls } from './Controls';
import { ExceedanceCalendar } from './ExceedanceCalendar';
import { MissedOpportunity } from './MissedOpportunity';
import { Choropleth } from './Choropleth';
import { DayCard } from './DayCard';
import { PlaybackBar } from './PlaybackBar';
import { usePlayback } from './usePlayback';

export function IndexView() {
  const { hazard, window: win, returnPeriod, selectedDate, setSelectedDate } = usePipelineStore();
  const [index, setIndex] = useState<CalendarIndex>({});
  const [emdatDates, setEmdatDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [calendarYear, setCalendarYear] = useState<number>(CAL_YEARS[0]);

  const playback = usePlayback({
    year: calendarYear,
    query: { hazard, window: win, returnPeriod },
    selectedDate: selectedDate ?? null,
    setSelectedDate,
  });

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
  }, [hazard, win, returnPeriod]);

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

        <Controls year={calendarYear} onYearChange={setCalendarYear} />

        <PlaybackBar playback={playback} />

        <div className='widgets'>
          <div className='wcol'>
            <ExceedanceCalendar
              index={index}
              emdatDates={emdatDates}
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
