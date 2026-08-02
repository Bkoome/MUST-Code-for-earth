'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadRegionRisksBatch } from 'app/lib/api/contract';
import type { UnitRisk } from 'app/types/contract';
import type { ExceedanceQuery } from 'app/types/exceedance';

// Time-lapse playback for the index view: auto-advances the selected day through
// a year (or one month). Region data for all summarized dates arrives in one
// batch request, so playback repaints without per-day fetches.

export type PlayScope = 'month' | 'year';
type RegionBatch = Record<string, Record<string, UnitRisk>>;

const SPEEDS = [1, 2, 4] as const; // multiplier; days/sec = 2 x multiplier

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
  summarized: number; // builder progress; a growing count refreshes the batch
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

export function usePlayback({
  year,
  query,
  selectedDate,
  setSelectedDate,
  summarized,
}: Args): Playback {
  const { window: win, returnPeriod, hazard } = query;
  const [scope, setScope] = useState<PlayScope>('year');
  const [speed, setSpeed] = useState<number>(1);
  const [playing, setPlaying] = useState(false);
  const [batch, setBatch] = useState<RegionBatch>({});

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

  // One batch request per query; re-runs as the builder summarizes more dates.
  useEffect(() => {
    let cancelled = false;
    loadRegionRisksBatch({ hazard, window: win, returnPeriod })
      .then((data) => !cancelled && setBatch(data))
      .catch((e) => {
        console.error('Failed to load regions batch', e);
        if (!cancelled) setBatch({});
      });
    return () => {
      cancelled = true;
    };
  }, [win, returnPeriod, hazard, summarized]);

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
    () => sequence.reduce((n, d) => (batch[d] ? n + 1 : n), 0),
    [sequence, batch],
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
    cachedRegions: selectedDate ? (batch[selectedDate] ?? null) : null,
  };
}
