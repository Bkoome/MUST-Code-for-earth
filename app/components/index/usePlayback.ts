'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadRegionRisks } from 'app/lib/api/contract';
import type { UnitRisk } from 'app/types/contract';
import type { ExceedanceQuery } from 'app/types/exceedance';

// Time-lapse playback for the index view: auto-advances the selected day through
// a year (or one month) so the calendar cursor sweeps and the choropleth recolors
// day-by-day. Region data for the whole range is prefetched + cached so playback
// is smooth.

export type PlayScope = 'month' | 'year';
type RegionCache = Map<string, Record<string, UnitRisk>>;

const SPEEDS = [1, 2, 4] as const; // multiplier; days/sec = 2 × multiplier
const PREFETCH_CONCURRENCY = 6;

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// Matches ExceedanceCalendar's cell-key construction, so the sequence aligns with
// the rendered calendar and the API lookups regardless of timezone offset.
function yearSequence(year: number): string[] {
  const days = isLeap(year) ? 366 : 365;
  return Array.from({ length: days }, (_, i) =>
    new Date(year, 0, 1 + i).toISOString().slice(0, 10),
  );
}

interface Args {
  year: number;
  query: ExceedanceQuery;
  selectedDate: string | null;
  setSelectedDate: (date: string) => void;
}

export interface Playback {
  playing: boolean;
  toggle: () => void;
  scope: PlayScope;
  setScope: (s: PlayScope) => void;
  speed: number;
  setSpeed: (s: number) => void;
  speeds: readonly number[];
  sequence: string[];
  cursorIndex: number;
  seek: (index: number) => void;
  buffered: number;
  cachedRegions: Record<string, UnitRisk> | null;
}

export function usePlayback({ year, query, selectedDate, setSelectedDate }: Args): Playback {
  const { window: win, returnPeriod, hazard } = query;
  const [scope, setScope] = useState<PlayScope>('year');
  const [speed, setSpeed] = useState<number>(1);
  const [playing, setPlaying] = useState(false);
  const [cache, setCache] = useState<RegionCache>(new Map());
  const cacheRef = useRef<RegionCache>(cache);
  cacheRef.current = cache;

  const monthMM = selectedDate ? selectedDate.slice(5, 7) : '01';
  const sequence = useMemo(() => {
    const full = yearSequence(year);
    return scope === 'month' ? full.filter((d) => d.slice(5, 7) === monthMM) : full;
  }, [year, scope, monthMM]);

  const cursorIndex = selectedDate ? sequence.indexOf(selectedDate) : -1;
  const cursorRef = useRef(cursorIndex);
  cursorRef.current = cursorIndex;
  const seqRef = useRef(sequence);
  seqRef.current = sequence;

  // Region risk depends on window/rp/hazard, so drop the cache when the query changes.
  useEffect(() => {
    const empty = new Map();
    cacheRef.current = empty;
    setCache(empty);
  }, [win, returnPeriod, hazard]);

  // Prefetch every in-scope day's regions, throttled to a few requests at a time.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const todo = sequence.filter((d) => !cacheRef.current.has(d));
      for (let i = 0; i < todo.length && !cancelled; i += PREFETCH_CONCURRENCY) {
        const batch = todo.slice(i, i + PREFETCH_CONCURRENCY);
        const loaded = await Promise.all(
          batch.map(async (d) => {
            try {
              return [d, await loadRegionRisks(d, { hazard, window: win, returnPeriod })] as const;
            } catch {
              return [d, {}] as const;
            }
          }),
        );
        if (cancelled) return;
        setCache((prev) => {
          const next = new Map(prev);
          for (const [d, r] of loaded) next.set(d, r);
          cacheRef.current = next;
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sequence, win, returnPeriod, hazard]);

  // Advance the cursor on a timer while playing; loop at the end of the sequence.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(
      () => {
        const seq = seqRef.current;
        if (seq.length === 0) return;
        const cur = cursorRef.current;
        setSelectedDate(seq[cur < 0 ? 0 : (cur + 1) % seq.length]);
      },
      1000 / (speed * 2),
    );
    return () => window.clearInterval(id);
  }, [playing, speed, setSelectedDate]);

  const buffered = useMemo(
    () => sequence.reduce((n, d) => (cache.has(d) ? n + 1 : n), 0),
    [sequence, cache],
  );

  return {
    playing,
    toggle: () => setPlaying((p) => !p),
    scope,
    setScope,
    speed,
    setSpeed,
    speeds: SPEEDS,
    sequence,
    cursorIndex,
    seek: (index) => sequence[index] && setSelectedDate(sequence[index]),
    buffered,
    cachedRegions: selectedDate ? (cache.get(selectedDate) ?? null) : null,
  };
}
