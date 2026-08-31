'use client';

import React, { useMemo, useState } from 'react';
import { usePipelineStore } from 'app/store/providers/pipeline';
import type { CalendarIndex } from 'app/types/contract';
import { color } from 'app/lib/exceedance-ramp';
import { MoiCards } from './MoiStories';
import type { MoiCase } from 'app/types/moi';

// Curated seasons worth walking through. Everything a card reports — the
// sparkline, the elevated-day count, the EM-DAT count, the day it opens — is
// read back out of the calendar feed for that window, so a card can never
// claim more than the archive holds.
interface Season {
  id: string;
  title: string;
  blurb: string;
  from: string; // inclusive ISO date
  to: string; // inclusive ISO date
}

const SEASONS: Season[] = [
  {
    id: 'ea-2024-long-rains',
    title: 'East Africa long rains',
    blurb:
      'Nairobi flooding and the Rift Valley dam failure, set against the ensemble exceedance signal that preceded them.',
    from: '2024-03-01',
    to: '2024-05-31',
  },
  {
    id: 'shabelle-juba-2023',
    title: 'Shabelle and Juba basins',
    blurb:
      'A late-season peak on the Somali rivers, and how many days ahead the longer accumulation windows saw it.',
    from: '2023-10-01',
    to: '2023-12-31',
  },
  {
    id: 'ea-2025-short-rains',
    title: 'Short rains, Greater Horn',
    blurb:
      'The October–December season, where short accumulation windows and river response part company.',
    from: '2025-10-01',
    to: '2025-12-31',
  },
];

interface Reading {
  days: string[]; // every day in range that the archive holds
  elevated: number; // worst_risk >= 2
  events: number; // EM-DAT matches in range
  peak: string | null; // strongest day, ties broken by the earlier date
  peakP: number; // that day's exceedance probability
  bars: { date: string; sev: number }[];
}

// Cap the sparkline so a 90-day season stays legible at card width.
const MAX_BARS = 46;

function read(season: Season, index: CalendarIndex, emdatDates: Set<string>): Reading {
  const days = Object.keys(index)
    .filter((d) => d >= season.from && d <= season.to)
    .sort();

  let elevated = 0;
  let events = 0;
  let peak: string | null = null;
  let peakP = -1;

  for (const d of days) {
    if (index[d].worst_risk >= 2) elevated++;
    if (emdatDates.has(d)) events++;
    // Rank on the probability itself: a season holds dozens of days in the top
    // severity class, so ranking on the class alone opens the first of them
    // rather than the strongest.
    if (index[d].p > peakP) {
      peakP = index[d].p;
      peak = d;
    }
  }

  // Thin evenly rather than truncating, so the bars still span the season.
  const stride = Math.max(1, Math.ceil(days.length / MAX_BARS));
  const bars = days.filter((_, i) => i % stride === 0).map((d) => ({ date: d, sev: index[d].p }));

  return { days, elevated, events, peak, peakP: Math.max(peakP, 0), bars };
}

interface Props {
  index: CalendarIndex;
  emdatDates: Set<string>;
  cases: MoiCase[];
  rp: string;
}

// Two ways into the archive, never at once: the seasons say where to walk, the
// cases say what the walk found. Seasons lead because they hold every day in the
// window, while the ledger holds five — stacking the two would have read as a
// section that grows more certain the further down it goes.
type View = 'seasons' | 'cases';

const HEADS: Record<View, string> = {
  seasons: 'Seasons worth walking through',
  cases: 'Three days worth explaining',
};

export function Storylines({ index, emdatDates, cases, rp }: Props) {
  const { openStory } = usePipelineStore();
  const [view, setView] = useState<View>('seasons');

  const readings = useMemo(
    () => SEASONS.map((s) => ({ season: s, reading: read(s, index, emdatDates) })),
    [index, emdatDates],
  );

  // The toggle is only offered where it leads somewhere: with no ledger the
  // section is the seasons, and a dead second pill would just be a broken promise.
  const canSwitch = cases.length > 0;
  const showing: View = canSwitch ? view : 'seasons';

  return (
    <section className='strand' id='storylines'>
      <div className='shell'>
        <div className='strand__hd'>
          <div>
            <span className='eyebrow'>Storylines</span>
            <h2>{HEADS[showing]}</h2>
          </div>
          {canSwitch ? (
            <div className='seg' role='group' aria-label='Storyline view'>
              <button
                className={showing === 'seasons' ? 'on' : ''}
                aria-pressed={showing === 'seasons'}
                onClick={() => setView('seasons')}
              >
                Seasons
              </button>
              <button
                className={showing === 'cases' ? 'on' : ''}
                aria-pressed={showing === 'cases'}
                onClick={() => setView('cases')}
              >
                Missed opportunities
              </button>
            </div>
          ) : null}
        </div>

        {showing === 'cases' ? <MoiCards cases={cases} rp={rp} /> : null}

        {showing === 'seasons' ? (
          <div className='cards'>
            {readings.map(({ season, reading }) => {
              const ready = reading.peak !== null;
              return (
                <button
                  key={season.id}
                  className='scard'
                  disabled={!ready}
                  onClick={() => reading.peak && openStory(reading.peak)}
                  title={
                    ready
                      ? `Open the ${reading.peak} storymap`
                      : 'This season is not in the archive yet'
                  }
                >
                  <div className='scard__bar' aria-hidden='true'>
                    {reading.bars.length ? (
                      reading.bars.map((b) => (
                        <span
                          key={b.date}
                          style={{
                            height: `${6 + b.sev * 20}px`,
                            background: color(b.sev),
                          }}
                        />
                      ))
                    ) : (
                      <span style={{ height: '2px', background: 'var(--rule)' }} />
                    )}
                  </div>
                  <span className='eyebrow'>{season.from.slice(0, 4)}</span>
                  <h3>{season.title}</h3>
                  <p>{season.blurb}</p>
                  <div className='scard__ft'>
                    {ready ? (
                      <>
                        <span>{reading.elevated} elevated days</span>
                        <span>{reading.events} EM-DAT events</span>
                        <span>
                          peak {reading.peak} · {Math.round(reading.peakP * 100)}%
                        </span>
                      </>
                    ) : (
                      <span>Awaiting archive</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
