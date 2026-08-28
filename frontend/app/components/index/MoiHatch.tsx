'use client';

import React from 'react';
import { HATCH_ID, VERDICT_COLOR } from 'app/types/moi';

// Shared <defs> for unscorable units, drawn in the calendar and the map alike so the
// same mark always means the same thing: no loss record reaches here.
export function MoiHatch() {
  return (
    <defs>
      <pattern
        id={HATCH_ID}
        width={5}
        height={5}
        patternUnits='userSpaceOnUse'
        patternTransform='rotate(45)'
      >
        <rect width={5} height={5} fill={VERDICT_COLOR.no_impact_data} />
        <line x1={0} y1={0} x2={0} y2={5} stroke='#93a7ae' strokeWidth={1.4} />
      </pattern>
    </defs>
  );
}
