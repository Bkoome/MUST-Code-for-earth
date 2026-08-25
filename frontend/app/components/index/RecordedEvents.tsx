'use client';

import React, { useEffect, useState } from 'react';
import { fetchDayEvents } from 'app/lib/api/catalogue';
import type { CatalogueEvent, DayEvents } from 'app/types/catalogue';
import { HAZARD_LABEL, SOURCE_LABEL } from 'app/types/catalogue';

const fmtInt = (n: number) => n.toLocaleString('en-GB');

const prettySpan = (start: string, end: string) => {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const from = new Date(`${start}T00:00:00`).toLocaleDateString('en-GB', opts);
  if (start === end) return from;
  const to = new Date(`${end}T00:00:00`).toLocaleDateString('en-GB', { ...opts, year: 'numeric' });
  return `${from} – ${to}`;
};

// Regions are listed with the weakest attribution flagged rather than hidden: a
// `macro` link means the source named a larger unit, so the region is a member
// of the affected area, not a confirmed one.
function Regions({ event }: { event: CatalogueEvent }) {
  if (!event.regions.length) {
    return <p className='ev__none'>No admin-1 unit could be resolved from this record.</p>;
  }
  return (
    <ul className='ev__regions'>
      {event.regions.map((r) => (
        <li key={r.gid} className={r.method === 'macro' ? 'ev__region ev__region--weak' : 'ev__region'}>
          {r.name}
          {r.method === 'macro' ? <i title='Source named a larger unit'>approx.</i> : null}
        </li>
      ))}
    </ul>
  );
}

function EventRow({ event }: { event: CatalogueEvent }) {
  const impacts: string[] = [];
  if (event.deaths) impacts.push(`${fmtInt(event.deaths)} dead`);
  if (event.affected) impacts.push(`${fmtInt(event.affected)} affected`);

  return (
    <li className='ev'>
      <div className='ev__hd'>
        <span className='ev__src'>{SOURCE_LABEL[event.source] ?? event.source}</span>
        <strong className='ev__haz'>{HAZARD_LABEL[event.hazard] ?? event.hazard}</strong>
        <span className='ev__span'>{prettySpan(event.start, event.end)}</span>
      </div>
      {impacts.length ? <p className='ev__impact'>{impacts.join(' · ')}</p> : null}
      {event.place ? <p className='ev__place'>{event.place}</p> : null}
      <Regions event={event} />
    </li>
  );
}

interface Props {
  date: string | null;
}

export function RecordedEvents({ date }: Props) {
  const [events, setEvents] = useState<DayEvents | null>(null);
  const [loading, setLoading] = useState(false);
  // Distinguishes "catalogue not mounted" from "mounted, nothing on this day".
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    if (!date) {
      setEvents(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
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

  return (
    <section className='recorded'>
      <div className='recorded__hd'>
        <h3 className='recorded__ttl'>What was recorded</h3>
        <span className='recorded__meta'>
          {loading ? <i className='spin inline' /> : `${events?.count ?? 0} events · ${date}`}
        </span>
      </div>

      {events && events.count > 0 ? (
        <ul className='ev-list'>
          {events.data.map((e) => (
            <EventRow key={e.event_id} event={e} />
          ))}
        </ul>
      ) : (
        !loading && (
          <p className='recorded__empty'>
            No event is recorded for this day. Absence is not evidence of calm: national loss
            databases cover the region unevenly, and the countries they miss are maintained by hand.
          </p>
        )
      )}
    </section>
  );
}
