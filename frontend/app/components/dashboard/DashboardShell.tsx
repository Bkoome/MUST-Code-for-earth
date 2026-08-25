'use client';

import React from 'react';
import { PipelineProvider, usePipelineStore } from 'app/store/providers/pipeline';
import { TopBar } from 'app/components/shell/TopBar';
import { SiteFooter } from 'app/components/shell/SiteFooter';
import { IndexView } from 'app/components/index/IndexView';
import { ScrollyStory } from 'app/components/story/ScrollyStory';

function Shell() {
  const { view, selectedDate } = usePipelineStore();
  const story = view === 'story';
  return (
    <>
      <TopBar />
      {story ? <ScrollyStory /> : <IndexView />}
      {/* Both views end in the footer. On the storymap it lands after the last
          chapter rather than inside the scrolly, so it closes the narrative
          instead of interrupting it. */}
      <SiteFooter
        inStory={story}
        note={story && selectedDate ? `Per-day storymap · ${selectedDate}` : null}
      />
    </>
  );
}

export function DashboardShell() {
  return (
    <PipelineProvider>
      <Shell />
    </PipelineProvider>
  );
}
