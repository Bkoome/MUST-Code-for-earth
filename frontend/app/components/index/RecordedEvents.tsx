'use client';

import React, { useEffect, useState } from 'react';
import { fetchDayEvents } from 'app/lib/api/catalogue';
import type { CatalogueEvent, DayEvents } from 'app/types/catalogue';
import { HAZARD_LABEL, SOURCE_LABEL } from 'app/types/catalogue';
import type { MoiVerdict } from 'app/types/moi';
import { VERDICT_COLOR, VERDICT_LABEL, VERDICT_NOTE } from 'app/types/moi';

const fmtInt = (n: number) => n.toLocaleString('en-GB');

// The year is dropped from the opening date only when both ends share it.
// A record running 2023-10-15 to 2024-12-28 read as "15 Oct – 28 Dec 2024"
// before, which put a fifteen-month span inside a single year.
const prettySpan = (start: string, end: string) => {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const from = new Date(`${start}T00:00:00`).toLocaleDateString(
    'en-GB',
    sameYear ? opts : { ...opts, year: 'numeric' },
  );
  if (start === end) return from;
  const to = new Date(`${end}T00:00:00`).toLocaleDateString('en-GB', { ...opts, year: 'numeric' });
  return `${from} – ${to}`;
};

// Mirrors AGGREGATE_SPAN_DAYS in backend/app/catalogue.py, which sorts records
// longer than this below the ones that bracket the selected day. Labelling them
// says why a record from another season is in the list at all.
const AGGREGATE_SPAN_DAYS = 92;

const spanDays = (start: string, end: string) =>
  Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);

const REGION_CAP = 8;

// Regions are listed with the weakest attribution flagged rather than hidden: a
// `macro` link means the source named a larger unit, so the region is a member
// of the affected area, not a confirmed one.
function Regions({ event }: { event: CatalogueEvent }) {
  const [all, setAll] = useState(false);
  if (!event.regions.length) {
    return <p className='ev__none'>No admin-1 unit could be resolved from this record.</p>;
  }
  // A single EM-DAT record can name 45 counties, which on its own outruns the
  // rest of the widget, so the tail is folded away until asked for.
  const shown = all ? event.regions : event.regions.slice(0, REGION_CAP);
  const hidden = event.regions.length - shown.length;
  return (
    <ul className='ev__regions'>
      {shown.map((r) => (
        <li
          key={r.gid}
          className={r.method === 'macro' ? 'ev__region ev__region--weak' : 'ev__region'}
        >
          {r.name}
          {r.method === 'macro' ? <i title='Source named a larger unit'>approx.</i> : null}
        </li>
      ))}
      {hidden > 0 ? (
        <li>
          <button type='button' className='ev__more' onClick={() => setAll(true)}>
            +{hidden} more
          </button>
        </li>
      ) : null}
    </ul>
  );
}

function EventRow({
  event,
  defaultOpen,
  verdict,
}: {
  event: CatalogueEvent;
  defaultOpen: boolean;
  verdict?: MoiVerdict;
}) {
  // A bad day carries fifty-six records. Each one opens to its place and its
  // regions on demand, so the ledger stays a scannable list of what happened
  // rather than a wall that has to be scrolled past.
  const [open, setOpen] = useState(defaultOpen);
  const hasDetail = Boolean(event.place) || event.regions.length > 0;
  const days = spanDays(event.start, event.end);
  const aggregate = days >= AGGREGATE_SPAN_DAYS;

  return (
    <li className={`ev${open ? ' is-open' : ''}${aggregate ? ' ev--aggregate' : ''}`}>
      <button
        type='button'
        className='ev__toggle'
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className='ev__hd'>
          <span className={`ev__src ev__src--${event.source}`}>
            {SOURCE_LABEL[event.source] ?? event.source}
          </span>
          <strong className='ev__haz'>{HAZARD_LABEL[event.hazard] ?? event.hazard}</strong>
          <span className='ev__span'>{prettySpan(event.start, event.end)}</span>
          {verdict ? (
            <span
              className='moi-chip moi-chip--row'
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
          ) : null}
          {aggregate ? (
            <span
              className='ev__agg'
              title={`This record spans ${days} days, so it covers the selected day without being an event of it.`}
            >
              {days}-day record
            </span>
          ) : null}
          {hasDetail ? <span className='ev__chev' aria-hidden='true' /> : null}
        </span>
        {event.deaths || event.affected ? (
          <span className='ev__impact'>
            {event.deaths ? (
              <span className='ev__toll'>
                <b>{fmtInt(event.deaths)}</b> dead
              </span>
            ) : null}
            {event.affected ? (
              <span className='ev__aff'>
                <b>{fmtInt(event.affected)}</b> affected
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
      {open && hasDetail ? (
        <div className='ev__detail'>
          {event.place ? <p className='ev__place'>{event.place}</p> : null}
          <Regions event={event} />
        </div>
      ) : null}
    </li>
  );
}

interface Props {
  date: string | null;
  // Worst verdict per event, empty when the evaluation is not mounted.
  verdicts?: Map<number, MoiVerdict>;
}

export function RecordedEvents({ date, verdicts }: Props) {
  const [events, setEvents] = useState<DayEvents | null>(null);
  const [loading, setLoading] = useState(false);
  // Distinguishes "catalogue not mounted" from "mounted, nothing on this day".
  const [disabled, setDisabled] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!date) {
      setEvents(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setShowAll(false);
    fetchDayEvents(date)
      .then((payload) => {
        if (cancelled) return;
        setDisabled(payload === null);
        setEvents(payload);
      })
      .catch((e) => {
        console.warn('[catalogue] events failed:', e);
        if (!cancelled) setEvents(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [date]);

  if (!date || disabled) return null;

  // Events arrive worst-impact first, so the first five are the ones that matter.
  const EVENT_CAP = 5;
  const shownEvents = showAll ? (events?.data ?? []) : (events?.data ?? []).slice(0, EVENT_CAP);
  const moreEvents = (events?.data.length ?? 0) - shownEvents.length;

  return (
    <section className='recorded'>
      <div className='recorded__hd'>
        <h3 className='recorded__ttl'>What was recorded</h3>
        <span className='recorded__meta'>
          {loading ? <i className='spin inline' /> : `${events?.count ?? 0} events · ${date}`}
        </span>
      </div>

      {/* The ledger runs long on a bad day. Standing beside the console it is
          capped to the console's own height and scrolls inside itself, so the
          deck keeps one baseline instead of one column trailing off. */}
      <div className='recorded__body'>
        {events && events.count > 0 ? (
          <>
            <ul className='ev-list'>
              {shownEvents.map((e, i) => (
                <EventRow
                  key={e.event_id}
                  event={e}
                  defaultOpen={i === 0}
                  verdict={verdicts?.get(e.event_id)}
                />
              ))}
            </ul>
            {moreEvents > 0 ? (
              <button type='button' className='recorded__more' onClick={() => setShowAll(true)}>
                Show {moreEvents} more {moreEvents === 1 ? 'event' : 'events'}
              </button>
            ) : null}
          </>
        ) : (
          !loading && (
            <p className='recorded__empty'>
              No event is recorded for this day. Absence is not evidence of calm: national loss
              databases cover the region unevenly, and the countries they miss are maintained by
              hand.
            </p>
          )
        )}
      </div>
    </section>
  );
}
