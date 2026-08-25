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

export function SiteFooter() {
  return (
    <footer className='foot' id='method'>
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
        <span className='readout'>
          <span className='pulse' />
          Code for Earth · <b>2026</b>
        </span>
      </div>
    </footer>
  );
}
