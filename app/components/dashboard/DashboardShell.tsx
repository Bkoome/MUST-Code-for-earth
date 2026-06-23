'use client';

import React from 'react';
import { PipelineProvider, usePipelineStore } from 'app/store/providers/pipeline';
import { TopBar } from 'app/components/shell/TopBar';
import { IndexView } from 'app/components/index/IndexView';
import { ScrollyStory } from 'app/components/story/ScrollyStory';

function Shell() {
  const { view } = usePipelineStore();
  return (
    <>
      <TopBar />
      {view === 'story' ? <ScrollyStory /> : <IndexView />}
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
