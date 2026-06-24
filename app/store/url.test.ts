import { describe, it, expect } from 'vitest';
import { buildUrl, parsePipelineParams } from 'app/store/url';
import { DEFAULT_PIPELINE_STATE } from 'app/types/pipeline';
import type { PipelineState } from 'app/types/pipeline';

describe('pipeline URL round-trip', () => {
  it('survives a state -> url -> params -> state round-trip', () => {
    const state: PipelineState = {
      view: 'story',
      hazard: 'flood',
      selectedDate: '2023-11-22',
      window: '48h',
      returnPeriod: '5yr',
    };
    const url = buildUrl(state);
    const params = new URLSearchParams(url.split('?')[1]);
    const parsed = parsePipelineParams(params);
    expect({ ...DEFAULT_PIPELINE_STATE, ...parsed }).toEqual(state);
  });

  it('omits date from the url when none is selected', () => {
    const url = buildUrl({ ...DEFAULT_PIPELINE_STATE, selectedDate: null });
    expect(url).not.toContain('date=');
  });

  it('ignores invalid params', () => {
    const parsed = parsePipelineParams(
      new URLSearchParams('view=bogus&window=99h&rp=10yr&date=not-a-date'),
    );
    expect(parsed).toEqual({ returnPeriod: '10yr' });
  });
});
