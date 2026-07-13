import { describe, it, expect, vi, beforeAll } from 'vitest';
import { RISK_COLOR } from 'app/types/contract';

// NEXT_PUBLIC_* env is read when app/config is first imported, so stub before loading.
let mod: typeof import('app/lib/tiles/cog-url');
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_TITILER_BASE', 'https://tiles.example');
  vi.stubEnv('NEXT_PUBLIC_COG_BASE', 's3://bucket/processed/must');
  mod = await import('app/lib/tiles/cog-url');
});

describe('COG keys', () => {
  it('builds the three contract key shapes', () => {
    expect(mod.gpmCogKey('2026-03-04')).toBe('gpm_2026-03-04.tif');
    expect(mod.exceedanceCogKey('2026-03-04', 24, 10)).toBe('exceedance_2026-03-04_24_10.tif');
    expect(mod.riskCogKey('2026-03-04')).toBe('risk_2026-03-04.tif');
  });

  it('rejects windows and return periods outside the pipeline dimensions', () => {
    expect(() => mod.exceedanceCogKey('2026-03-04', 99, 10)).toThrow(/window/);
    expect(() => mod.exceedanceCogKey('2026-03-04', 24, 7)).toThrow(/return period/);
  });
});

describe('cogTileUrl', () => {
  it('targets the stock /cog endpoint with literal XYZ placeholders', () => {
    const url = mod.cogTileUrl(mod.gpmCogKey('2026-03-04'));
    expect(url).toContain('https://tiles.example/cog/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png');
    expect(url).toContain(encodeURIComponent('s3://bucket/processed/must/gpm_2026-03-04.tif'));
  });

  it('applies per-kind rendering params', () => {
    expect(mod.cogTileUrl('gpm_2026-03-04.tif')).toContain('colormap_name=blues&rescale=0,100');
    expect(mod.cogTileUrl('exceedance_2026-03-04_24_10.tif')).toContain(
      'colormap_name=ylorrd&rescale=0,1',
    );
    const risk = mod.cogTileUrl('risk_2026-03-04.tif');
    expect(risk).toContain(`colormap=${encodeURIComponent(mod.RISK_CMAP_JSON)}`);
    expect(risk).not.toContain('colormap_name');
  });

  it('keeps the discrete risk colormap identical to the vector legend', () => {
    expect(JSON.parse(mod.RISK_CMAP_JSON)).toEqual({
      0: RISK_COLOR[0],
      1: RISK_COLOR[1],
      2: RISK_COLOR[2],
      3: RISK_COLOR[3],
    });
  });
});
