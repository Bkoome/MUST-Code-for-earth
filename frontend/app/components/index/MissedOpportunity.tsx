'use client';

import React from 'react';

// Reserved slot below the calendar, pending the forecast-signal-vs-recorded-
// EM-DAT index. It states what will land here rather than apologising for the
// gap.
export function MissedOpportunity({ year }: { year: number }) {
  return (
    <section className='reserved' aria-label='Missed opportunity index'>
      <h4>Missed opportunity index · {year} — in development</h4>
      <p>
        Will weigh the forecast exceedance signal against recorded EM-DAT flood events, to surface
        the days the ensemble flagged a flood that was missed operationally.
      </p>
    </section>
  );
}
