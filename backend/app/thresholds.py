"""CMORPH return-period thresholds for the exceedance layer.

Source file (NetCDF or zarr) carries `return_period_precip` with dims
(duration, return_period, lat, lon), durations labelled like "24hr"/"7day".
load() standardizes that to (window_h, return_period, lat, lon) in mm,
interpolated onto the store grid, so derive.exceedance_field can `.sel()`
directly. Returns None when CMORPH_THRESHOLDS_URL is unset (layer disabled).
"""

import logging
import re

import xarray as xr

from . import config, store

log = logging.getLogger(__name__)


def _duration_to_hours(label: str) -> int | None:
    m = re.fullmatch(r"(\d+)\s*(h|hr|hour|hours)", str(label).strip().lower())
    if m:
        return int(m.group(1))
    m = re.fullmatch(r"(\d+)\s*(d|day|days)", str(label).strip().lower())
    if m:
        return int(m.group(1)) * 24
    return None


def load() -> xr.DataArray | None:
    if not config.CMORPH_THRESHOLDS_URL:
        log.warning("CMORPH_THRESHOLDS_URL unset - exceedance layer disabled")
        return None
    try:
        return _load(config.CMORPH_THRESHOLDS_URL)
    except Exception:
        log.exception(
            "failed to load thresholds from %s - exceedance layer disabled",
            config.CMORPH_THRESHOLDS_URL,
        )
        return None


def _load(url: str) -> xr.DataArray:
    ds = xr.open_zarr(url) if url.rstrip("/").endswith(".zarr") else xr.open_dataset(url)
    rp = ds["return_period_precip"]

    hours = [_duration_to_hours(d) for d in rp["duration"].values]
    keep = [i for i, h in enumerate(hours) if h in config.WINDOWS_H]
    rp = rp.isel(duration=keep).assign_coords(
        duration=[hours[i] for i in keep]
    ).rename({"duration": "window_h"})

    # Align to the store grid (CMORPH grid may differ).
    grid = store.get_dataset()
    rp = rp.interp(lat=grid.lat, lon=grid.lon, method="linear")

    units = str(rp.attrs.get("units", "mm")).lower()
    if units in ("m", "meter", "metre", "meters", "metres"):
        rp = rp * 1000.0

    rp = rp.astype("float32").load()
    log.info(
        "thresholds loaded from %s: windows=%s rps=%s",
        url, rp["window_h"].values.tolist(), rp["return_period"].values.tolist(),
    )
    return rp
