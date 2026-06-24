'use client';

import React, { forwardRef } from 'react';
import type { ChapterConfig } from './storyConfig';

interface Props {
  config: ChapterConfig;
  isActive: boolean;
}

// A single scrollytelling chapter card. Authored in code today; the same shape is
// what a per-day MDX <Chapter> block produces.
export const Chapter = forwardRef<HTMLDivElement, Props>(function Chapter(
  { config, isActive },
  ref,
) {
  return (
    <div className={`chapter${isActive ? ' is-active' : ''}`} ref={ref}>
      <div className='card'>
        <div className='banner' style={{ ['--img' as any]: `url(${config.banner})` }}>
          <span className='tag'>{config.tag}</span>
        </div>
        <div className='k'>{config.kicker}</div>
        <h3>{config.title}</h3>
        <p>{config.body}</p>
        <div className='statline'>
          {config.stats.map((stat) => (
            <div key={stat.label}>
              <b>{stat.value}</b>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
