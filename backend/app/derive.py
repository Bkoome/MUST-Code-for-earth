"""Derived fields (window accumulations, ensemble stats, exceedance) with an LRU cache.

Store chunks span all lead times per (init_date, member), so a full-date cube read
is the I/O unit. The first request for a date loads the cube once, derives per-member
accumulations for every window, caches those small fields, and drops the cube.
"""

import logging
import threading
import time
from collections import OrderedDict, deque
from pathlib import Path

import numpy as np
import xarray as xr

from . import config, store

log = logging.getLogger(__name__)

# date -> {window_h: DataArray (member, lat, lon) in mm}
_fields: OrderedDict[str, dict[int, xr.DataArray]] = OrderedDict()
_fields_lock = threading.Lock()
_date_locks: dict[str, threading.Lock] = {}

# Counters plus the most recent cold-derive timings; the deque keeps /xr/stats a
# fixed-size payload over the thousands of dates the builder eventually sweeps.
stats = {
    "cache_hits": 0,
    "cache_misses": 0,
    "disk_hits": 0,
    "evictions": 0,
    "compute_seconds": deque(maxlen=50),
}

# (window_h, return_period, lat, lon) in mm, aligned to the store grid
_thresholds: xr.DataArray | None = None

# (date, window_h, rp) -> JSON-ready member-trajectory payload for the storymap chart
_traj: OrderedDict[tuple[str, int, int], dict] = OrderedDict()


def _date_lock(date: str) -> threading.Lock:
    with _fields_lock:
        return _date_locks.setdefault(date, threading.Lock())


def _fields_path(date: str) -> Path:
    return Path(config.CACHE_DIR) / "fields" / f"{date}.npz"


def _load_fields(date: str) -> dict[int, xr.DataArray] | None:
    """Rebuild a date's derived fields from the on-disk cache; None on miss."""
    path = _fields_path(date)
    if not path.exists():
        return None
    try:
        ds = store.get_dataset()
        coords = {"member": ds["member"].values, "lat": ds.lat.values, "lon": ds.lon.values}
        with np.load(path) as z:
            return {
                int(w): xr.DataArray(
                    z[w], coords=coords, dims=("member", "lat", "lon"), name=f"tp_{w}h_mm"
                )
                for w in z.files
            }
    except Exception:
        log.exception("fields cache unreadable for %s, recomputing", date)
        return None


def _save_fields(date: str, fields: dict[int, xr.DataArray]) -> None:
    """Write-through so evicted dates reload from disk instead of a full S3 derive."""
    path = _fields_path(date)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp")
    try:
        with open(tmp, "wb") as f:
            np.savez(f, **{str(w): da.values for w, da in fields.items()})
        tmp.rename(path)
    except Exception:
        log.exception("fields cache write failed for %s", date)
        tmp.unlink(missing_ok=True)


def member_windows(date: str) -> dict[int, xr.DataArray]:
    """All per-member window accumulations for one init_date, in mm (cached)."""
    with _fields_lock:
        if date in _fields:
            _fields.move_to_end(date)
            stats["cache_hits"] += 1
            return _fields[date]

    # Concurrent requests for a cold date wait for a single load.
    with _date_lock(date):
        with _fields_lock:
            if date in _fields:
                _fields.move_to_end(date)
                stats["cache_hits"] += 1
                return _fields[date]

        stats["cache_misses"] += 1
        fields = _load_fields(date)
        if fields is not None:
            stats["disk_hits"] += 1
            log.info("fields cache hit for %s", date)
        else:
            ds = store.get_dataset()
            lead_h = store.lead_hours()
            t0 = time.perf_counter()
            cube = ds["tp"].sel(init_date=date).compute()  # meters, (member, lead, lat, lon)
            idx = {int(h): int(np.argmin(np.abs(lead_h - h))) for h in (0, *config.WINDOWS_H)}
            fields = {
                w: ((cube.isel(lead_time=idx[w]) - cube.isel(lead_time=idx[0])) * 1000.0)
                .astype("float32")
                .rename(f"tp_{w}h_mm")
                for w in config.WINDOWS_H
            }
            del cube
            elapsed = time.perf_counter() - t0
            stats["compute_seconds"].append(round(elapsed, 2))
            log.info("derived %s: all windows in %.1fs", date, elapsed)
            _save_fields(date, fields)

        with _fields_lock:
            _fields[date] = fields
            _fields.move_to_end(date)
            while len(_fields) > config.CACHE_DATES:
                evicted, _ = _fields.popitem(last=False)
                stats["evictions"] += 1
                log.info("cache evicted %s", evicted)
        return fields


def cached_dates() -> list[str]:
    with _fields_lock:
        return list(_fields.keys())


def has_fields(date: str) -> bool:
    """True when the date's derived fields are on disk."""
    return _fields_path(date).exists()


def tp_field(date: str, window_h: int, member: str = "mean") -> xr.DataArray:
    """(lat, lon) accumulation in mm: ensemble mean or a single member."""
    field = member_windows(date)[window_h]
    if member == "mean":
        return field.mean("member")
    return field.sel(member=member)


def set_thresholds(da: xr.DataArray | None) -> None:
    global _thresholds
    _thresholds = da


def has_thresholds() -> bool:
    return _thresholds is not None


def exceedance_field(date: str, window_h: int, rp: int) -> xr.DataArray:
    """(lat, lon) fraction of members exceeding the return-period threshold."""
    if _thresholds is None:
        raise RuntimeError("thresholds not loaded (set CMORPH_THRESHOLDS_URL)")
    field = member_windows(date)[window_h]
    thr = _thresholds.sel(window_h=window_h, return_period=rp)
    return (field > thr).sum("member") / field.sizes["member"]


def ensemble_trajectory(date: str, window_h: int, rp: int) -> dict:
    """Per-member cumulative tp (mm) at the forecast hotspot, lead 0..window_h.

    The hotspot is the domain cell with the most members over the rp threshold
    (the same peak-signal cell the calendar counts), falling back to the wettest
    ensemble-mean cell when no member exceeds. Reads one lat/lon column across all
    members and lead times through the same store/Dask path the fields use, so it
    stays a tiny slice rather than a full-cube derive. Cached per (date, window, rp).
    """
    from . import regions  # deferred: regions imports derive, so import lazily to avoid a cycle

    if _thresholds is None:
        raise RuntimeError("thresholds not loaded (set CMORPH_THRESHOLDS_URL)")

    key = (date, window_h, rp)
    with _fields_lock:
        if key in _traj:
            _traj.move_to_end(key)
            return _traj[key]

    with _date_lock(f"traj-{date}-{window_h}-{rp}"):
        with _fields_lock:
            if key in _traj:
                _traj.move_to_end(key)
                return _traj[key]

        window = member_windows(date)[window_h]
        domain = regions.domain_mask()
        thr_field = _thresholds.sel(window_h=window_h, return_period=rp).values  # (lat, lon) mm
        valid = np.isfinite(thr_field)  # restrict to cells that actually have a threshold
        sel = valid if domain is None else (domain & valid)
        if not sel.any():  # no domain cell has a threshold (shouldn't happen); relax to any valid cell
            sel = valid

        # Hotspot: peak-signal cell (most members over threshold); wettest mean cell as fallback.
        # Confined to cells with a finite threshold so the payload never carries a NaN.
        exceed = exceedance_field(date, window_h, rp).values
        pick = np.where(sel, exceed, -1.0)
        if np.nanmax(pick) > 0:
            flat = int(np.nanargmax(pick))
        else:
            mean_mm = np.where(sel, window.mean("member").values, -np.inf)
            flat = int(np.nanargmax(mean_mm))
        lat_i, lon_j = (int(v) for v in np.unravel_index(flat, exceed.shape))
        lat = float(window.lat.values[lat_i])
        lon = float(window.lon.values[lon_j])

        # Cumulative accumulation curve at the hotspot across the full 0..168h horizon,
        # so the plume always shows the multi-day build-up rather than just the window.
        # The selected window's verifying lead is marked as the "event"; membership over
        # threshold is judged there, matching member_windows / the calendar members stat.
        ds = store.get_dataset()
        lead_h = store.lead_hours()
        horizon = max(config.WINDOWS_H)
        keep = np.nonzero(lead_h <= horizon)[0]
        event_idx = int(np.argmin(np.abs(lead_h[keep] - window_h)))
        column = (
            ds["tp"].sel(init_date=date).isel(lat=lat_i, lon=lon_j, lead_time=keep).compute()
        )  # (member, lead) meters, cumulative from init
        cum = ((column - column.isel(lead_time=0)) * 1000.0).astype("float32").values  # (member, lead)
        cum = np.nan_to_num(cum, nan=0.0, posinf=0.0, neginf=0.0)  # keep the payload JSON-compliant

        thr = float(thr_field[lat_i, lon_j])  # finite by construction (sel ⊆ valid)
        labels = ds["member"].values.tolist()
        members = [
            {
                "label": str(m),
                "values": [round(float(v), 1) for v in cum[k]],
                "over": bool(cum[k, event_idx] > thr),
            }
            for k, m in enumerate(labels)
        ]
        payload = {
            "date": date,
            "window_h": window_h,
            "rp": rp,
            "leads": [int(lead_h[i]) for i in keep],
            "event_index": event_idx,
            "threshold_mm": round(thr, 1),
            "hotspot": {"lat": round(lat, 3), "lon": round(lon, 3)},
            "n_over": int(sum(m["over"] for m in members)),
            "n_members": len(members),
            "members": members,
        }
        with _fields_lock:
            _traj[key] = payload
            _traj.move_to_end(key)
            while len(_traj) > config.CACHE_DATES:
                _traj.popitem(last=False)
        return payload
