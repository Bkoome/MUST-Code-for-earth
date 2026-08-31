// Pure URL <-> state helpers for the pipeline store. Kept framework-free so they
// can be unit-tested without React / next/navigation.
import type {
  AccumWindow,
  ReturnPeriod,
  PipelineState,
  AppView,
  DisasterType,
} from 'app/types/pipeline';
import { ACCUM_WINDOWS, RETURN_PERIODS } from 'app/types/pipeline';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Build a shareable, deep-linkable query URL for the current state. */
export function buildUrl(s: PipelineState): string {
  const params = new URLSearchParams();
  params.set('view', s.view);
  params.set('hazard', s.hazard);
  params.set('window', s.window);
  params.set('rp', s.returnPeriod);
  if (s.selectedDate) params.set('date', s.selectedDate);
  return `/?${params.toString()}`;
}

/** Parse the valid subset of pipeline state from URL params. */
export function parsePipelineParams(sp: URLSearchParams): Partial<PipelineState> {
  const updates: Partial<PipelineState> = {};

  const view = sp.get('view');
  if (view === 'index' || view === 'story') updates.view = view as AppView;

  const hazard = sp.get('hazard');
  if (hazard === 'flood') updates.hazard = hazard as DisasterType;

  const window = sp.get('window') as AccumWindow | null;
  if (window && ACCUM_WINDOWS.includes(window)) updates.window = window;

  const rp = sp.get('rp') as ReturnPeriod | null;
  if (rp && RETURN_PERIODS.includes(rp)) updates.returnPeriod = rp;

  const date = sp.get('date');
  if (date && DATE_RE.test(date)) updates.selectedDate = date;

  return updates;
}
