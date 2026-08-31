'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePipelineStore } from 'app/store/providers/pipeline';
import { fetchDayVerdicts, fetchMoiInfo } from 'app/lib/api/moi';
import { SOURCE_LABEL } from 'app/types/catalogue';
import {
  NOTHING_MEANING,
  NOTHING_TO_EVALUATE,
  VERDICT_LABEL,
  VERDICT_MEANING,
  VERDICT_PHRASE,
  VERDICT_TONE,
  verdictSentence,
} from 'app/types/moi';
import type { MoiDay, MoiInfo, MoiUnit, Verdict } from 'app/types/moi';

const num = (n: number) => n.toLocaleString('en-US');
const pct = (p: number) => `${Math.round(p * 100)}%`;
const mm = (v: number | null) => (v != null ? v.toFixed(0) : '\u2014');

// One fact per row: the reader sees the inputs and the verdict together, so the
// chip never carries a claim the evidence beside it does not already make.
function Fact({ label, answer, detail }: { label: string; answer: string; detail: string }) {
  return (
    <div className='verdict__fact'>
      <span className='verdict__fkey'>{label}</span>
      <span className='verdict__fval'>
        <b>{answer}</b> {detail}
      </span>
    </div>
  );
}

function impactFact(u: MoiUnit) {
  if (u.event) {
    const toll: string[] = [];
    if (u.event.deaths) toll.push(`${num(u.event.deaths)} dead`);
    if (u.event.affected) toll.push(`${num(u.event.affected)} affected`);
    const src = SOURCE_LABEL[u.event.source] ?? u.event.source;
    return {
      answer: 'Yes',
      detail: `${u.name ?? u.gid}${toll.length ? ` · ${toll.join(' · ')}` : ''} · ${src}`,
    };
  }
  if (u.verdict === 'no_impact_data') {
    return { answer: 'Unknown', detail: `no loss register reaches ${u.name ?? u.gid}` };
  }
  return { answer: 'No', detail: 'nothing entered in the national register for this day' };
}

// Two rainfall readings exist and they are not the same claim: a unit can clear
// the observation bar on the day itself, or the event's peak can fall a day
// either side of it inside the join tolerance. Saying "ordinary" for the second
// would contradict the verdict standing above it.
function rainFact(u: MoiUnit) {
  if (u.obs_rp) {
    return {
      answer: `${mm(u.obs_mm)} mm`,
      detail: `cleared the ${u.obs_rp}-year daily level here`,
    };
  }
  const peak = u.event?.obs_mm ?? null;
  if (u.event?.tier === 'assessable') {
    return {
      answer: `${mm(peak)} mm`,
      detail: 'peak across the recorded event, above the 2-year daily level',
    };
  }
  return {
    answer: 'Ordinary',
    detail:
      peak != null
        ? `${mm(peak)} mm at the peak — no 2-year extreme in the affected region`
        : 'no daily extreme observed here',
  };
}

function forecastFact(u: MoiUnit, rp: number, bar: number) {
  if (u.anticipated) {
    const lead = u.lead_h ?? 24;
    return {
      answer: 'Yes',
      detail: `${lead > 0 ? `${lead} h ahead` : 'on the day itself'} · ${pct(u.p_best ?? 0)} of members at the ${rp}-year level`,
    };
  }
  if (u.verdict === 'forecast_miss') {
    return {
      answer: 'No',
      detail: `no run reached the ${pct(bar)} bar at the ${rp}-year level, at any lead`,
    };
  }
  // No signal was read at all: the backend scores the forecast only where a
  // rainfall extreme was observed, so "No" here would assert an unmade check.
  if (u.p_best == null) {
    return {
      answer: 'Not assessed',
      detail: 'the forecast is only scored where a rainfall extreme was observed',
    };
  }
  return {
    answer: 'No',
    detail: u.p_best
      ? `best run reached ${pct(u.p_best)} of members, under the ${pct(bar)} bar`
      : `no member reached the ${rp}-year level`,
  };
}

// The chip and the one thing a new reader needs to read it: what this verdict
// means inside MUST. Per verdict, not one panel-wide note — a reader meets only
// the verdict their day carries, and each word means something different.
function Call({ label, tone, meaning }: { label: string; tone: string; meaning: string }) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (
        popRef.current &&
        !popRef.current.contains(e.target as Node) &&
        e.target !== btnRef.current
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('click', away);
    return () => document.removeEventListener('click', away);
  }, []);

  // The explainer is per verdict, so it closes whenever the verdict changes
  // under it rather than standing over a claim it no longer explains.
  useEffect(() => setOpen(false), [label]);

  return (
    <div className='verdict__call'>
      <span className={`verdict__chip verdict__chip--${tone}`}>{label}</span>
      <button
        ref={btnRef}
        className={`verdict__i${open ? ' on' : ''}`}
        aria-label={`What \u201c${label}\u201d means`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        i
      </button>
      <div ref={popRef} className={`verdict__pop${open ? ' on' : ''}`} role='note'>
        <b>{label}</b>
        {meaning}
      </div>
    </div>
  );
}

// Everything else on the day, counted rather than listed: on 426 of 549 evaluated
// days there is nothing else, and on the rest the second reading is a footnote.
function elsewhere(units: MoiUnit[]) {
  const counts = new Map<string, number>();
  for (const u of units.slice(1)) {
    counts.set(u.verdict, (counts.get(u.verdict) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const parts = Array.from(counts).map(
    ([v, n]) => `${n} ${n === 1 ? 'region' : 'regions'} ${VERDICT_PHRASE[v as Verdict]}`,
  );
  return `Elsewhere on this day: ${parts.join(', ')}.`;
}

// The caveats, quoted from the build rather than typed here, so they cannot drift
// away from the numbers the verdict was actually computed with.
function Caveats({ info }: { info: MoiInfo | null }) {
  const m = info?.meta ?? {};
  const bar = pct(Number(m.strong_p ?? 0.15));
  const events = Number(m.impact_events ?? 0);
  const outside = Number(m.outside_rainfall_model ?? 0);
  const share = events ? Math.round((outside / events) * 100) : 0;
  return (
    <details className='verdict__more'>
      <summary>How this is judged, and what it cannot tell you</summary>
      <ul>
        <li>
          <b>The three tests.</b> Rainfall is <i>observed</i> when daily IMERG clears the{' '}
          {m.obs_rp ?? 2}-year level; the forecast <i>flagged</i> it when at least {bar} of{' '}
          {m.members ?? 51} ensemble members reach the selected return level a day or more ahead; a
          flood record is joined to the day within ±{m.join_tolerance_days ?? 1} day.
        </li>
        <li>
          <b>Absence of a record is not calm.</b> Loss registers reach only{' '}
          {m.scorable_countries ?? 'four countries'} inside this archive, and Kenya&rsquo;s stops in
          July 2025. &ldquo;No impact recorded&rdquo; elsewhere is missing data, never a warning
          that worked.
        </li>
        <li>
          <b>Most recorded floods are outside this hazard.</b> {outside} of {events} ({share}%) had
          no observed rainfall extreme in the affected region — they are outside the rainfall model,
          not missed by it.
        </li>
        <li>
          <b>This is a ledger, not a rate.</b> Only {m.assessable_events ?? 5} events across the
          archive can be scored at all, and events lasting more than {m.max_scored_span_days ?? 7}{' '}
          days are not scored. Counting these verdicts into a percentage would overstate what they
          support.
        </li>
        <li>
          <b>No warning archive exists.</b> Nothing records whether a warning was issued or acted
          on, so &ldquo;missed opportunity&rdquo; means the chance to act existed — not that anyone
          failed to take it.
        </li>
        <li>
          <b>The comparison is not symmetrical.</b> The forecast side takes a maximum over{' '}
          {m.members ?? 51} members and every grid cell in a region; the observation is one
          interpolated daily field. False alarms are inflated by that alone, so none of this should
          be read as a forecast skill score.
        </li>
        <li>
          <b>Attribution carries its own uncertainty.</b> Some records name an area larger than a
          region and are placed at half confidence, and the DesInventar reader has not been checked
          against an official export.
        </li>
      </ul>
    </details>
  );
}

// The evaluation of one selected day: three facts and the verdict they force.
// Deliberately the only place a verdict appears — the calendar keeps its
// exceedance ramp and the map keeps its probabilities, because an outcome is a
// different kind of claim and must not be read as a hotter shade of a forecast.
export function MissedOpportunity({ date }: { date: string | null }) {
  const { returnPeriod } = usePipelineStore();
  const [day, setDay] = useState<MoiDay | null>(null);
  const [info, setInfo] = useState<MoiInfo | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    fetchMoiInfo()
      .then((i) => {
        if (!live) return;
        setInfo(i);
        if (!i) setDisabled(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!date) {
      setDay(null);
      return;
    }
    let live = true;
    setLoading(true);
    fetchDayVerdicts(date, returnPeriod)
      .then((d) => {
        if (!live) return;
        setDay(d);
        if (!d) setDisabled(true);
      })
      .catch(() => {
        // A failed read is not a quiet day. Rendering nothing is the only honest
        // fallback, so it degrades exactly as a missing catalogue does.
        if (live) {
          setDay(null);
          setDisabled(true);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [date, returnPeriod]);

  if (disabled) return null;

  // With no day chosen the slot still says what it is for, rather than leaving a
  // gap on the pane floor beside the map.
  if (!date) {
    return (
      <section className='verdict' aria-label='Missed opportunity'>
        <div className='verdict__hd'>
          <h3 className='verdict__ttl'>Did we see it coming?</h3>
        </div>
        <p className='verdict__prompt'>
          Pick a day to read the forecast against what was actually recorded.
        </p>
      </section>
    );
  }

  const lead = day?.data?.[0] ?? null;
  const rp = day?.rp ?? Number(returnPeriod.replace('yr', ''));
  const bar = Number(info?.meta?.strong_p ?? 0.15);
  const tone = lead ? VERDICT_TONE[lead.verdict] : 'muted';
  const also = day?.data?.length ? elsewhere(day.data) : null;

  return (
    <section className='verdict' aria-label='Missed opportunity'>
      <div className='verdict__hd'>
        <h3 className='verdict__ttl'>Did we see it coming?</h3>
        <span className='verdict__meta'>
          {date} · {rp}-year bar
          {loading ? <i className='spin inline' /> : null}
        </span>
      </div>

      <div className='verdict__body'>
        <Call
          label={lead ? VERDICT_LABEL[lead.verdict] : 'Nothing to evaluate'}
          tone={tone}
          meaning={lead ? VERDICT_MEANING[lead.verdict] : NOTHING_MEANING}
        />
        <p className='verdict__line'>{lead ? verdictSentence(lead, rp) : NOTHING_TO_EVALUATE}</p>

        {lead ? (
          <div className='verdict__facts'>
            <Fact label='Flood recorded' {...impactFact(lead)} />
            <Fact label='Rainfall observed' {...rainFact(lead)} />
            <Fact label='Forecast flagged' {...forecastFact(lead, rp, bar)} />
          </div>
        ) : null}

        {also ? <p className='verdict__also'>{also}</p> : null}

        <Caveats info={info} />
      </div>
    </section>
  );
}
