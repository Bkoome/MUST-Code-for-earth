'use client';

import React from 'react';
import { PipelineProvider, usePipelineStore } from 'app/store/providers/pipeline';
import { TopBar } from 'app/components/shell/TopBar';
import { SiteFooter } from 'app/components/shell/SiteFooter';
import { IndexView } from 'app/components/index/IndexView';
import { ScrollyStory } from 'app/components/story/ScrollyStory';

function Shell() {
  const { view } = usePipelineStore();
  const story = view === 'story';
  return (
    <>
      <TopBar />
      {story ? <ScrollyStory /> : <IndexView />}
      {/* The storymap runs its own full-bleed scrolly to the bottom of the
          page; the footer would cut that ending short. */}
      {story ? null : <SiteFooter />}
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
