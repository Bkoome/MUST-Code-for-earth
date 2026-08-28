'use client';

import React from 'react';
import type { MoiCase, MoiFeed, MoiVerdict } from 'app/types/moi';
import { MOI_DEFINITION, VERDICT_COLOR, VERDICT_LABEL, VERDICT_NOTE } from 'app/types/moi';

const pct = (v: number | null) => (v == null ? '—' : `${(100 * v).toFixed(1)}%`);
const fmtInt = (n: number) => n.toLocaleString('en-GB');

const TIER_LABEL: Record<string, string> = {
  assessable: 'Assessable',
  outside_rainfall_model: 'Outside the rainfall model',
  span_too_long: 'Season-scale record',
  no_forecast: 'No forecast covers it',
};

const prettySpan = (start: string, end: string) => {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: '2-digit' };
  const from = new Date(`${start}T00:00:00`).toLocaleDateString('en-GB', opts);
  return start === end
    ? from
    : `${from} – ${new Date(`${end}T00:00:00`).toLocaleDateString('en-GB', opts)}`;
};

function Chip({ verdict }: { verdict: MoiVerdict }) {
  return (
    <span
      className='moi-chip'
      style={{
        background: VERDICT_COLOR[verdict],
        color:
          verdict === 'no_recorded_impact' || verdict === 'outside_rainfall_model'
            ? '#08202b'
            : '#fff',
      }}
      title={VERDICT_NOTE[verdict]}
    >
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

// The counts move sharply with the return period, so the movement is rendered rather than
// left for a reader to infer from whichever pill they happened to land on.
function Sensitivity({ feed }: { feed: MoiFeed }) {
  const cases = new Map(feed.case_counts.map((c) => [c.rp, c]));
  return (
    <table className='moi-sens'>
      <thead>
        <tr>
          <th>Return period</th>
          <th>Flagged ahead</th>
          <th>False alarms</th>
          <th>Missed opps.</th>
        </tr>
      </thead>
      <tbody>
        {feed.anticipation.by_rp.map((row) => (
          <tr key={row.rp} className={row.rp === feed.rp ? 'is-here' : undefined}>
            <th scope='row'>{row.rp} yr</th>
            <td>{pct(row.hit_rate)}</td>
            <td>{pct(row.far)}</td>
            <td>{cases.get(row.rp)?.missed_opportunity ?? 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// A late warning is found at lead 0, and "0 h ahead" reads as though it were still
// something to act on. It was not.
const leadPhrase = (item: MoiCase) => {
  if (item.best_lead_h == null) return 'no qualifying signal at any lead';
  const share = `${Math.round(100 * (item.p_best ?? 0))}% of members`;
  return item.best_lead_h === 0
    ? `${share}, on the day itself`
    : `${share}, ${item.best_lead_h} h ahead`;
};

function CaseRow({ item }: { item: MoiCase }) {
  return (
    <li className='moi-case'>
      <span className='moi-case__hd'>
        <Chip verdict={item.verdict} />
        <b>{item.region}</b>
        <span className='moi-case__when'>{prettySpan(item.start, item.end)}</span>
      </span>
      <span className='moi-case__facts'>
        {item.obs_mm != null ? <span>{item.obs_mm.toFixed(0)} mm observed</span> : null}
        <span>{leadPhrase(item)}</span>
        {item.deaths ? <span>{fmtInt(item.deaths)} dead</span> : null}
        {item.affected ? <span>{fmtInt(item.affected)} affected</span> : null}
      </span>
    </li>
  );
}

interface Props {
  year: number;
  feed: MoiFeed | null;
  loading: boolean;
}

export function MissedOpportunity({ year, feed, loading }: Props) {
  // Absent tables are a deployment state, not an error: say what would be here and stop.
  if (!feed) {
    return (
      <section className='reserved' aria-label='Missed opportunity index'>
        <h4>Missed opportunity index{loading ? ' · loading' : ' · not mounted'}</h4>
        <p>
          Weighs the forecast signal against recorded floods. Needs the <code>moi_*</code> tables in
          the mounted catalogue database; build them with <code>tools/moi/build_moi.py</code>.
        </p>
      </section>
    );
  }

  const { anticipation: ant, attribution: att } = feed;
  const outside = att.tiers.find((t) => t.tier === 'outside_rainfall_model');
  const assessable = att.tiers.find((t) => t.tier === 'assessable');
  const outsideShare = outside && att.events ? Math.round((100 * outside.events) / att.events) : 0;
  const here = feed.case_counts.find((c) => c.rp === feed.rp);
  const softest = feed.case_counts[0];
  const hardest = feed.case_counts[feed.case_counts.length - 1];

  return (
    <section className='moi' aria-label='Missed opportunity index'>
      <header className='moi__hd'>
        <h4>Missed opportunity index</h4>
        <span className='moi__yr'>{year}</span>
        <details className='moi__about'>
          <summary>About</summary>
          <div className='moi__aboutbody'>
            <p className='moi__def'>{MOI_DEFINITION}</p>
            <p>
              The third clause is <b>unverified</b>, not satisfied: MUST holds no warning registry,
              so every case reads <code>none_available</code> for a warning record.
            </p>
            <p>
              The {outside?.events ?? 0} floods outside the rainfall model are{' '}
              <b>not missed warnings</b>. No unusual rainfall was observed in the unit they damaged,
              so they are a hazard this system does not forecast — routed flood water, a river
              crest, a drainage failure — rather than a forecast that failed.
            </p>
            <p>
              A signal qualifies at {Math.round(100 * ant.strong_p)}% of the ensemble over the
              return level. The observation bar is fixed at the {ant.obs_rp}-yr level and does not
              move with the pill: it asks whether something unusual fell, not whether it was as rare
              as the thing forecast.
            </p>
          </div>
        </details>
      </header>

      {/* 1 — the only population large enough to carry a rate. */}
      <div className='moi__read'>
        <p className='moi__kicker'>
          Anticipation <span>· {fmtInt(ant.population)} observed extremes</span>
        </p>
        <p className='moi__lead'>
          <b>{pct(ant.at_rp?.hit_rate ?? null)}</b> flagged ≥ {ant.lead_hours} h ahead
          <i>·</i>
          <b>{pct(ant.at_rp?.far ?? null)}</b> of those flags saw no extreme
        </p>
        <p className='moi__note'>
          {ant.at_rp
            ? `${fmtInt(ant.at_rp.hits)} hits, ${fmtInt(ant.at_rp.misses)} misses and ${fmtInt(ant.at_rp.false_alarms)} false alarms at the ${feed.rp}-yr bar. `
            : ''}
          The false-alarm ratio is inflated by scale: the forecast side maxes over 51 members and
          every cell in a unit, the observation side is one field regridded 0.1° to 0.4°.
        </p>
        <Sensitivity feed={feed} />
      </div>

      {/* 2 — how much of the recorded burden this system could ever have caught. */}
      <div className='moi__read'>
        <p className='moi__kicker'>
          Attribution <span>· {att.events} recorded floods</span>
        </p>
        <p className='moi__lead'>
          <b>
            {outside?.events ?? 0} of {att.events}
          </b>{' '}
          ({outsideShare}%) sit outside the rainfall hazard
        </p>
        <ul className='moi-tiers'>
          {att.tiers.map((t) => (
            <li key={t.tier}>
              <span
                className='moi-tiers__bar'
                style={{ width: `${(100 * t.events) / Math.max(att.events, 1)}%` }}
              />
              <span className='moi-tiers__lbl'>{TIER_LABEL[t.tier] ?? t.tier}</span>
              <span className='moi-tiers__n'>{t.events}</span>
            </li>
          ))}
        </ul>
        <p className='moi__note'>
          Mean observed peak in those units was {outside?.mean_obs_mm?.toFixed(0) ?? '—'} mm,
          against {assessable?.mean_obs_mm?.toFixed(0) ?? '—'} mm for the assessable events.
          Ordinary rain, not a near miss.
        </p>
      </div>

      {/* 3 — the ledger. Five events cannot carry a rate, so they are named. */}
      <div className='moi__read'>
        <p className='moi__kicker'>
          Cases{' '}
          <span>
            · {feed.cases.length} assessable at the {feed.rp}-yr bar
          </span>
        </p>
        <ul className='moi-cases'>
          {feed.cases.map((c) => (
            <CaseRow key={`${c.event_id}-${c.gid}`} item={c} />
          ))}
        </ul>
        {here && softest && hardest ? (
          <p className='moi__note'>
            {here.missed_opportunity} missed{here.late_warning ? `, ${here.late_warning} late` : ''}{' '}
            at this bar — {softest.missed_opportunity} at {softest.rp} yr and{' '}
            {hardest.missed_opportunity} at {hardest.rp} yr. Too few events for a rate; read them
            one by one.
          </p>
        ) : null}
      </div>
    </section>
  );
}
