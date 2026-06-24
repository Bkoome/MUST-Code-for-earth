'use client';

import React from 'react';
import { CAL_YEARS } from 'app/types/pipeline';

// Placeholder "missed opportunity index" widget below the calendar, pending the
// forecast-signal-vs-recorded-EM-DAT index.
interface Props {
  year?: number;
}

export function MissedOpportunity({ year = CAL_YEARS[0] }: Props) {
  return (
    <section className='widget wreserved' aria-label='Missed opportunity index'>
      <div className='wtitle'>
        Missed opportunity <b>· {year}</b>
      </div>
      <div className='wreserved-body'>
        Reserved: missed-opportunity index. Forecast exceedance signal weighed against recorded
        EM-DAT flood events, to surface days the ensemble flagged a flood that was missed
        operationally.
      </div>
    </section>
  );
}
