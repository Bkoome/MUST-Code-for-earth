import { describe, it, expect, vi, beforeAll } from 'vitest';

// NEXT_PUBLIC_* env is read when app/config is first imported, so stub before loading.
let mod: typeof import('app/lib/tiles/xr-url');
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_TILER_XR_BASE', 'http://tiler.example');
  mod = await import('app/lib/tiles/xr-url');
});

describe('xrTpTileUrl', () => {
  it('targets /xr/tiles with literal XYZ placeholders and science params', () => {
    const url = mod.xrTpTileUrl('2026-03-15', 24);
    expect(url).toContain('http://tiler.example/xr/tiles/WebMercatorQuad/{z}/{x}/{y}.png');
    expect(url).toContain('date=2026-03-15');
    expect(url).toContain('layer=tp');
    expect(url).toContain('window=24h');
    expect(url).toContain('member=mean');
  });

  it('names a single ensemble member when requested', () => {
    expect(mod.xrTpTileUrl('2026-03-15', 72, 'ens_07')).toContain('member=ens_07');
  });

  it('rejects windows outside the store lead_time boundaries', () => {
    expect(() => mod.xrTpTileUrl('2026-03-15', 99)).toThrow(/window/);
  });
});

describe('xrExceedanceTileUrl', () => {
  it('carries window and return period', () => {
    const url = mod.xrExceedanceTileUrl('2026-03-15', 168, 50);
    expect(url).toContain('layer=exceedance');
    expect(url).toContain('window=168h');
    expect(url).toContain('rp=50');
  });

  it('accepts only the return periods present in the CMORPH file (50, not 40)', () => {
    expect(() => mod.xrExceedanceTileUrl('2026-03-15', 24, 40)).toThrow(/return period/);
    expect(mod.xrExceedanceTileUrl('2026-03-15', 24, 50)).toContain('rp=50');
  });
});
