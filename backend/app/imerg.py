"""GPM IMERG daily observed rainfall for the storymap observation layer.

Source file (NetCDF or zarr) carries daily `precipitation` in mm on a (time,
lat, lon) grid. load() interpolates it onto the store grid and holds it for the
process lifetime. observed_window sums the daily grids spanning a forecast
window so the observed field lines up with derive.tp_field. Windows shorter than
a day are unsupported by the daily product and return None (frontend grays out).
"""

import logging
import threading

import numpy as np
import xarray as xr

from . import config, store

log = logging.getLogger(__name__)

_lock = threading.Lock()
_daily: xr.DataArray | None = None  # (time, lat, lon) in mm, on the store grid


def load() -> None:
    """Open and regrid the IMERG daily file once; no-op when disabled or missing."""
    global _daily
    if not config.IMERG_DAILY_URL:
        log.warning("IMERG_DAILY_URL unset - observation layer disabled")
        return
    try:
        _daily = _load(config.IMERG_DAILY_URL)
        log.info("imerg loaded: %d days %s..%s", len(coverage()), coverage()[0], coverage()[-1])
    except Exception:
        log.exception(
            "failed to load imerg from %s - observation layer disabled",
            config.IMERG_DAILY_URL,
        )
        _daily = None


def _load(url: str) -> xr.DataArray:
    ds = xr.open_zarr(url) if url.rstrip("/").endswith(".zarr") else xr.open_dataset(url)
    da = ds["precipitation"]

    # Normalize dim order and day-floor the time axis for exact date selection.
    if "lat" not in da.dims or "lon" not in da.dims:
        da = da.rename({"latitude": "lat", "longitude": "lon"})
    da = da.transpose("time", "lat", "lon")
    da = da.assign_coords(time=da["time"].dt.floor("D"))

    # Align to the store grid (IMERG is 0.1deg, the store is finer).
    grid = store.get_dataset()
    da = da.interp(lat=grid.lat, lon=grid.lon, method="linear")

    units = str(da.attrs.get("units", "mm")).lower()
    if units in ("m", "meter", "metre", "meters", "metres"):
        da = da * 1000.0

    return da.astype("float32").load()


def available() -> bool:
    return _daily is not None


def coverage() -> list[str]:
    """Days present, as YYYY-MM-DD ascending; empty when disabled."""
    if _daily is None:
        return []
    return [np.datetime_as_string(t, unit="D") for t in np.sort(_daily["time"].values)]


def observed_window(date: str, window_h: int) -> xr.DataArray | None:
    """(lat, lon) observed rainfall in mm over [0, window_h] from date; None if unavailable."""
    if _daily is None or window_h % 24 != 0:
        return None
    with _lock:
        start = np.datetime64(date, "D")
        wanted = {start + np.timedelta64(i, "D") for i in range(window_h // 24)}
        # Day-floor the (ns) time axis so selection is dtype-safe.
        days = _daily["time"].values.astype("datetime64[D]")
        if not wanted <= set(days):
            return None
        field = _daily.isel(time=np.isin(days, list(wanted))).sum("time")
    return field.rename(f"obs_{window_h}h_mm")
