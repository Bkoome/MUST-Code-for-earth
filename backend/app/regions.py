"""Admin-1 aggregation of exceedance fields, using masks rasterized once.

Each region is rasterized separately. A single rasterize() call over all 227
polygons cannot work here: it writes shapes in list order, so with all_touched
a later polygon overwrites an earlier one in every cell they share, and a small
region next to a large one ends up with no cells and a permanent 0.0. That cost
32 of 227 regions at 0.25 deg and 58 at 0.4 deg, silently. Rasterized on its own
every region gets at least one cell at both resolutions, so the fix is to let
regions overlap rather than to raise the resolution.
"""

import json
import logging
from pathlib import Path

import numpy as np
import xarray as xr
from rasterio import features
from rasterio.transform import from_origin

from . import config, derive, store

log = logging.getLogger(__name__)

# Flat cell indices per region, aligned with _meta. Ragged rather than a labels
# grid because regions must be allowed to claim the same cell: at these
# resolutions a shared border cell is often the only cell a small region has.
_cells: list[np.ndarray] | None = None
_meta: list[dict] = []  # aligned with _cells [{gid, name}]
_domain: np.ndarray | None = None  # boolean union of every region's cells
_domain_da: xr.DataArray | None = None  # the same mask as a DataArray, for clipping


def init() -> None:
    """Rasterize admin-1 polygons onto the store grid (one-time, at startup)."""
    global _cells, _meta, _domain, _domain_da
    try:
        gj = json.loads(Path(config.ADM1_GEOJSON).read_text())
    except FileNotFoundError:
        log.warning("adm1 geojson missing at %s: regions endpoint disabled", config.ADM1_GEOJSON)
        return

    ds = store.get_dataset()
    lat, lon = ds.lat.values, ds.lon.values
    res = float(abs(lat[1] - lat[0]))
    transform = from_origin(lon.min() - res / 2, lat.max() + res / 2, res, res)

    shape = (lat.size, lon.size)
    flip = lat[0] < lat[-1]  # rasterize is north-up; flip to match ascending-lat fields
    cells, meta, domain, empty = [], [], np.zeros(shape, dtype=bool), []
    for f in gj["features"]:
        mask = features.rasterize(
            [(f["geometry"], 1)], out_shape=shape, transform=transform,
            fill=0, all_touched=True,
        ).astype(bool)
        if flip:
            mask = np.flipud(mask)
        if not mask.any():
            # Smaller than one cell and not touching any: nothing can be reported
            # for it, so say so at startup rather than serving a silent 0.0.
            empty.append(f["properties"]["name"])
        cells.append(np.flatnonzero(mask))
        domain |= mask
        meta.append({"gid": f["properties"]["gid"], "name": f["properties"]["name"]})

    _cells, _meta, _domain = cells, meta, domain
    _domain_da = xr.DataArray(domain, coords={"lat": lat, "lon": lon}, dims=("lat", "lon"))
    log.info("adm1 masks ready: %d regions on %s grid, %d cells in domain",
             len(_meta), shape, int(domain.sum()))
    if empty:
        log.warning("adm1: %d region(s) cover no grid cell and will always read 0.0: %s",
                    len(empty), ", ".join(empty))


def available() -> bool:
    return _cells is not None


def meta() -> list[dict]:
    """Region metadata [{gid, name}] in label order."""
    return _meta


def region_max(field: np.ndarray) -> np.ndarray:
    """Max field value per region, gathering each region's own cells.

    NaN reads as 0.0, matching the previous behaviour: an absent value is not
    evidence of exceedance.
    """
    flat = np.nan_to_num(field, nan=0.0).ravel()
    out = np.zeros(len(_meta), dtype="float64")
    for i, idx in enumerate(_cells):
        if idx.size:
            out[i] = flat[idx].max()
    return out


def domain_mask() -> np.ndarray | None:
    """Boolean grid of cells inside any admin-1 region."""
    return _domain


def clip_to_domain(da: xr.DataArray) -> xr.DataArray:
    """NaN outside the admin-1 domain so rendered tiles stop at the ICPAC boundary."""
    return da.where(_domain_da) if _domain_da is not None else da


def day_regions(date: str, window_h: int, rp: int) -> list[dict]:
    """Worst-cell exceedance per admin-1 region, computed from the derived field."""
    exceed = derive.exceedance_field(date, window_h, rp).values
    per_region = region_max(exceed)
    return [
        {"shapeID": m["gid"], "shapeName": m["name"], "p": round(float(p), 4)}
        for m, p in zip(_meta, per_region)
    ]
