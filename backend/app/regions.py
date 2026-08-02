"""Admin-1 aggregation of exceedance fields, using masks rasterized once."""

import json
import logging
from pathlib import Path

import numpy as np
import xarray as xr
from rasterio import features
from rasterio.transform import from_origin

from . import config, derive, store

log = logging.getLogger(__name__)

_labels: np.ndarray | None = None  # grid of region indices, 0 = no region
_meta: list[dict] = []  # index-1 aligned [{gid, name}]
_domain_da: xr.DataArray | None = None  # boolean domain mask on the store grid


def init() -> None:
    """Rasterize admin-1 polygons onto the store grid (one-time, at startup)."""
    global _labels, _meta, _domain_da
    try:
        gj = json.loads(Path(config.ADM1_GEOJSON).read_text())
    except FileNotFoundError:
        log.warning("adm1 geojson missing at %s: regions endpoint disabled", config.ADM1_GEOJSON)
        return

    ds = store.get_dataset()
    lat, lon = ds.lat.values, ds.lon.values
    res = float(abs(lat[1] - lat[0]))
    transform = from_origin(lon.min() - res / 2, lat.max() + res / 2, res, res)

    shapes = [(f["geometry"], i + 1) for i, f in enumerate(gj["features"])]
    grid = features.rasterize(
        shapes, out_shape=(lat.size, lon.size), transform=transform, fill=0, all_touched=True
    )
    if lat[0] < lat[-1]:  # rasterize is north-up; flip to match ascending-lat fields
        grid = np.flipud(grid)

    _labels = grid
    _meta = [{"gid": f["properties"]["gid"], "name": f["properties"]["name"]} for f in gj["features"]]
    _domain_da = xr.DataArray(grid > 0, coords={"lat": lat, "lon": lon}, dims=("lat", "lon"))
    log.info("adm1 masks ready: %d regions on %s grid", len(_meta), grid.shape)


def available() -> bool:
    return _labels is not None


def meta() -> list[dict]:
    """Region metadata [{gid, name}] in label order."""
    return _meta


def region_max(field: np.ndarray) -> np.ndarray:
    """Max field value per region, one pass over the labels grid."""
    acc = np.zeros(len(_meta) + 1, dtype="float64")
    np.maximum.at(acc, _labels.ravel(), np.nan_to_num(field, nan=0.0).ravel())
    return acc[1:]


def domain_mask() -> np.ndarray | None:
    """Boolean grid of cells inside any admin-1 region."""
    return _labels > 0 if _labels is not None else None


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
