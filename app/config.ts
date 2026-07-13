// Tile and data backend. Set NEXT_PUBLIC_TILER_XR_BASE in .env.local.
export const TILER_XR_BASE = process.env.NEXT_PUBLIC_TILER_XR_BASE ?? '';

// East Africa map extent [west, south, east, north].
export const EA_BBOX: [number, number, number, number] = [21, -12, 52, 23];
