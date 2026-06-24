'use client';

import React, { createContext, useContext, useMemo, useReducer, useEffect, ReactNode } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type {
  DisasterType,
  AppView,
  AccumWindow,
  ReturnPeriod,
  PipelineState,
} from 'app/types/pipeline';
import { DEFAULT_PIPELINE_STATE } from 'app/types/pipeline';
import { buildUrl, parsePipelineParams } from 'app/store/url';

interface PipelineContextType extends PipelineState {
  setView: (view: AppView) => void;
  setHazard: (hazard: DisasterType) => void;
  setSelectedDate: (date: string | null) => void;
  setWindow: (window: AccumWindow) => void;
  setReturnPeriod: (rp: ReturnPeriod) => void;
  // Convenience: select a day AND jump straight into its storymap.
  openStory: (date: string) => void;
}

const noop = () => undefined;

const PipelineContext = createContext<PipelineContextType>({
  ...DEFAULT_PIPELINE_STATE,
  setView: noop,
  setHazard: noop,
  setSelectedDate: noop,
  setWindow: noop,
  setReturnPeriod: noop,
  openStory: noop,
});

type Action =
  | { type: 'setView'; payload: AppView }
  | { type: 'setHazard'; payload: DisasterType }
  | { type: 'setSelectedDate'; payload: string | null }
  | { type: 'setWindow'; payload: AccumWindow }
  | { type: 'setReturnPeriod'; payload: ReturnPeriod }
  | { type: 'openStory'; payload: string }
  | { type: 'syncFromUrl'; payload: Partial<PipelineState> };

function reducer(state: PipelineState, action: Action): PipelineState {
  switch (action.type) {
    case 'setView':
      return { ...state, view: action.payload };
    case 'setHazard':
      return { ...state, hazard: action.payload };
    case 'setSelectedDate':
      return { ...state, selectedDate: action.payload };
    case 'setWindow':
      return { ...state, window: action.payload };
    case 'setReturnPeriod':
      return { ...state, returnPeriod: action.payload };
    case 'openStory':
      return { ...state, view: 'story', selectedDate: action.payload };
    case 'syncFromUrl':
      return { ...state, ...action.payload };
    default:
      return state;
  }
}

export function PipelineProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, dispatch] = useReducer(reducer, DEFAULT_PIPELINE_STATE);

  // Sync FROM URL (on mount + back/forward).
  useEffect(() => {
    const updates = parsePipelineParams(new URLSearchParams(searchParams.toString()));
    if (Object.keys(updates).length > 0) {
      dispatch({ type: 'syncFromUrl', payload: updates });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const value = useMemo(() => {
    // Push TO URL after applying an action to the latest state snapshot.
    const push = (next: PipelineState) => router.replace(buildUrl(next), { scroll: false });

    return {
      ...state,
      setView: (view: AppView) => {
        dispatch({ type: 'setView', payload: view });
        push({ ...state, view });
      },
      setHazard: (hazard: DisasterType) => {
        dispatch({ type: 'setHazard', payload: hazard });
        push({ ...state, hazard });
      },
      setSelectedDate: (date: string | null) => {
        dispatch({ type: 'setSelectedDate', payload: date });
        push({ ...state, selectedDate: date });
      },
      setWindow: (window: AccumWindow) => {
        dispatch({ type: 'setWindow', payload: window });
        push({ ...state, window });
      },
      setReturnPeriod: (returnPeriod: ReturnPeriod) => {
        dispatch({ type: 'setReturnPeriod', payload: returnPeriod });
        push({ ...state, returnPeriod });
      },
      openStory: (date: string) => {
        dispatch({ type: 'openStory', payload: date });
        push({ ...state, view: 'story', selectedDate: date });
      },
    };
  }, [state, router]);

  return <PipelineContext.Provider value={value}>{children}</PipelineContext.Provider>;
}

export function usePipelineStore() {
  return useContext(PipelineContext);
}
