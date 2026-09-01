'use client';

import React from 'react';
import { REPO_URL } from 'app/config';

// Placeholder targets: Method / Data sources / API get their own routes once
// those pages exist, so they point at the relevant on-page section for now.
const LINKS: { label: string; href: string; external?: boolean }[] = [
  { label: 'Method', href: '#storylines' },
  { label: 'Data sources', href: '#storylines' },
  { label: 'API', href: `${REPO_URL}#api`, external: true },
  { label: 'Partners', href: '#top' },
  { label: 'GitHub', href: REPO_URL, external: true },
];

interface Props {
  // The storymap supplies its own dark ground and ends flush with the last
  // chapter, so the footer drops its usual spacing there.
  inStory?: boolean;
  // What the reader was looking at, shown only where the page has a subject.
  // The storymap used to end in a band of its own saying this; it says it here
  // now, so the page closes once rather than twice.
  note?: string | null;
}

export function SiteFooter({ inStory = false, note = null }: Props) {
  return (
    <footer className={inStory ? 'foot foot--story' : 'foot'} id='method'>
      <div className='shell foot__in'>
        <nav className='foot__links' aria-label='Footer'>
          {LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              {...(l.external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
            >
              {l.label}
            </a>
          ))}
        </nav>
        <span className='foot__end'>
          {note ? <span className='foot__note'>{note}</span> : null}
          <span className='readout'>
            <span className='pulse' />
            Code for Earth · <b>2026</b>
          </span>
        </span>
      </div>
    </footer>
  );
}
