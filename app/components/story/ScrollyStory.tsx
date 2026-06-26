'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePipelineStore } from 'app/store/providers/pipeline';
import { buildStory } from './storyConfig';
import { StoryMap } from './StoryMap';
import { StoryTop } from './StoryTop';
import { Chapter } from './Chapter';

// Fallback day used when arriving at the storymap without a selected date.
const DEFAULT_DATE = '2023-11-22';

export function ScrollyStory() {
  const { selectedDate } = usePipelineStore();
  const date = selectedDate ?? DEFAULT_DATE;
  const chapters = useMemo(() => buildStory(date), [date]);

  const [activeIndex, setActiveIndex] = useState(0);
  const chapterRefs = useRef<(HTMLDivElement | null)[]>([]);
  const bgLayersRef = useRef<(HTMLDivElement | null)[]>([]);
  const frontRef = useRef(0);
  const curBgRef = useRef('');

  // Crossfade the pinned backdrop to the active chapter's image.
  const setChapterBg = (bg: string) => {
    const layers = bgLayersRef.current;
    if (layers.length < 2 || !bg || bg === curBgRef.current) return;
    curBgRef.current = bg;
    const back = layers[frontRef.current ^ 1];
    const front = layers[frontRef.current];
    if (back) {
      back.style.backgroundImage = `url(${bg})`;
      back.classList.add('on');
    }
    if (front) front.classList.remove('on');
    frontRef.current ^= 1;
  };

  // IntersectionObserver scrollytelling: the active chapter drives map + backdrop.
  useEffect(() => {
    setChapterBg(chapters[0].bg);
    const els = chapterRefs.current.filter(Boolean) as HTMLDivElement[];
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting && en.intersectionRatio > 0.5) {
            const idx = els.indexOf(en.target as HTMLDivElement);
            if (idx >= 0) {
              setActiveIndex(idx);
              setChapterBg(chapters[idx].bg);
            }
          }
        });
      },
      { threshold: [0.5], rootMargin: '-10% 0px -40% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters]);

  return (
    <section className='story'>
      <StoryTop date={date} severity='SEVERE · 0.74 exceedance' />

      <div className='scrolly'>
        <div className='pin'>
          <StoryMap active={chapters[activeIndex] ?? null} />
        </div>

        <div className='chapters'>
          <div className='chapter-bg'>
            <div className='cbg-layer' ref={(el) => (bgLayersRef.current[0] = el)} />
            <div className='cbg-layer' ref={(el) => (bgLayersRef.current[1] = el)} />
            <div className='shade' />
          </div>
          <div className='mdx-note'>
            This pane is the per-day storymap. Authors write prose + <code>&lt;Chapter&gt;</code>{' '}
            blocks; the pinned map reacts as each chapter scrolls into view (IntersectionObserver,
            no Mapbox lock-in).
          </div>

          {chapters.map((c, i) => (
            <Chapter
              key={c.id}
              config={c}
              isActive={i === activeIndex}
              ref={(el) => (chapterRefs.current[i] = el)}
            />
          ))}
        </div>
      </div>

      <footer>MUST · Code for Earth 2026 · per-day storymap · {date}</footer>
    </section>
  );
}
