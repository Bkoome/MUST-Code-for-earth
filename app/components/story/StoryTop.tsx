'use client';

import React from 'react';
import { usePipelineStore } from 'app/store/providers/pipeline';

interface Props {
  date: string;
  severity: string; // e.g. "SEVERE · 0.74 exceedance"
}

export function StoryTop({ date, severity }: Props) {
  const { setView } = usePipelineStore();
  return (
    <div className='story-top'>
      <button className='back' onClick={() => setView('index')}>
        ← Calendar
      </button>
      <span className='crumb'>
        Flood · <b>{date}</b> · Greater Horn of Africa
      </span>
      <span className='sev'>{severity}</span>
    </div>
  );
}
