import React from 'react';
import type { Metadata, Viewport } from 'next';
import { Manrope, IBM_Plex_Mono, Source_Serif_4 } from 'next/font/google';
import './styles/redesign.css';

// Three faces, three jobs. Sans carries the interface — headings, nav, buttons,
// labels. Manrope is a variable weight-only face (200–800), so headings set
// their emphasis with font-weight rather than the width axis Archivo offered.
const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
});

// Serif carries the content: body copy, captions, chapter narrative.
const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-content',
  display: 'swap',
});

// Mono carries every number, so dates and counts stop jittering during
// time-lapse playback.
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-data',
  display: 'swap',
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#08202b',
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'MUST: Monitoring & Understanding SpatioTemporal Flood Risk',
    template: '%s | MUST',
  },
  description:
    'MUST turns ECMWF IFS ensemble forecasts into daily flood-relevant exceedance probabilities across East Africa, paired with recorded impacts: a calendar-map index and per-day storymaps.',
  openGraph: {
    title: 'MUST Floodrisk Toolkit',
    description:
      '1,000 days of flood-relevant risk at a glance: a daily exceedance calendar + per-day scrollytelling storymaps for East Africa.',
    url: siteUrl,
    siteName: 'MUST',
    locale: 'en_US',
    type: 'website',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en' className={`${manrope.variable} ${sourceSerif.variable} ${plexMono.variable}`}>
      <body>
        <main id='pagebody' tabIndex={-1}>
          {children}
        </main>
      </body>
    </html>
  );
}
