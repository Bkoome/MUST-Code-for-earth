import { describe, expect, it } from 'vitest';
import { boundsForRegions, type Adm1Collection } from './camera';

const fc: Adm1Collection = {
  features: [
    {
      properties: { gid: 'A_1', name: 'Alpha' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [30, -2],
            [32, -2],
            [32, 1],
            [30, 1],
            [30, -2],
          ],
        ],
      },
    },
    {
      properties: { gid: 'B_1', name: 'Beta' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [35, 3],
              [37, 3],
              [37, 5],
              [35, 5],
              [35, 3],
            ],
          ],
        ],
      },
    },
  ],
};

describe('boundsForRegions', () => {
  it('returns the bbox of a single region', () => {
    expect(boundsForRegions(fc, ['A_1'])).toEqual([
      [30, -2],
      [32, 1],
    ]);
  });

  it('unions the bboxes of several regions', () => {
    expect(boundsForRegions(fc, ['A_1', 'B_1'])).toEqual([
      [30, -2],
      [37, 5],
    ]);
  });

  it('returns null when nothing matches', () => {
    expect(boundsForRegions(fc, ['Z_1'])).toBeNull();
  });
});
