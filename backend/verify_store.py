#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = [
#     "icechunk",
#     "xarray",
#     "zarr",
#     "dask[array]",
#     "numpy",
#     "pandas",
#     "psutil",
# ]
# ///
"""M1 verification for the titiler-xarray service (plan: declarative-wiggling-fountain).

Checks, against the published EA tp Icechunk store on source.coop:
  1. anonymous open works from this machine
  2. dims / coords / dtype / units / on-disk chunk layout
  3. Dask-backed open (chunks) and the chunk layout xarray reports
  4. timing: 24h-window accumulation + ensemble mean for one init_date,
     via the local threaded Dask scheduler with a bounded thread pool
  5. timing: exceedance-style reduction (fraction of members over a
     synthetic threshold) on the same window
  6. presence of the CMORPH return-period thresholds file (candidates)
  7. resolved package versions to pin in requirements.txt

Usage:  uv run verify_store.py [--date YYYY-MM-DD]
"""

import argparse
import importlib.metadata as md
import os
import time
from pathlib import Path

import numpy as np
import pandas as pd
import psutil

S3_BUCKET = "us-west-2.opendata.source.coop"
S3_PREFIX = "e4drr-project/forecasts/ecmwf_ea_tp_icechunk"
S3_REGION = "us-west-2"

CMORPH_CANDIDATES = [
    "/scratch/notebook/cmorph_ea_return_periods.nc",
    str(Path.home() / "cmorph_ea_return_periods.nc"),
    str(Path.home() / "projects/MUST/Backend/data/cmorph_ea_return_periods.nc"),
]

# Bounded threads are enough for the verify pass.
DASK_THREADS = max(2, (os.cpu_count() or 4) - 1)


def hr(title: str) -> None:
    print(f"\n{'=' * 70}\n{title}\n{'=' * 70}")


def mem_mb() -> float:
    return psutil.Process().memory_info().rss / 1e6


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=None, help="init_date to time (default: latest)")
    args = parser.parse_args()

    import dask
    import icechunk
    import xarray as xr

    dask.config.set(scheduler="threads", num_workers=DASK_THREADS)

    hr("1. Versions")
    for pkg in ("icechunk", "xarray", "zarr", "dask", "numpy", "pandas"):
        print(f"  {pkg:<10} {md.version(pkg)}")
    print(f"  dask threads: {DASK_THREADS} (of {os.cpu_count()} cores)")
    print(f"  RSS at start: {mem_mb():.0f} MB")

    hr("2. Anonymous open (eager metadata)")
    t0 = time.perf_counter()
    storage = icechunk.s3_storage(
        bucket=S3_BUCKET, prefix=S3_PREFIX, region=S3_REGION, anonymous=True
    )
    repo = icechunk.Repository.open(storage)
    session = repo.readonly_session("main")
    ds = xr.open_zarr(session.store, consolidated=False, chunks=None)
    print(f"  open time: {time.perf_counter() - t0:.2f}s")
    print(f"  dims: {dict(ds.sizes)}")
    tp = ds["tp"]
    print(f"  tp dtype: {tp.dtype}; attrs: {dict(tp.attrs)}")
    print(f"  tp encoding chunks (on-disk): {tp.encoding.get('chunks')}")
    dates = pd.to_datetime(ds["init_date"].values)
    print(f"  init_date: {len(dates)} dates, {dates.min().date()} .. {dates.max().date()}")
    lead_vals = ds["lead_time"].values
    if np.issubdtype(lead_vals.dtype, np.timedelta64):
        lead_h = (lead_vals / np.timedelta64(1, "h")).astype(int)
    else:
        lead_h = lead_vals.astype(int)  # stored as plain hours
    print(f"  lead_time hours: {lead_h.tolist()}")
    print(f"  members: {ds['member'].values[:3].tolist()} .. n={ds.sizes['member']}")
    print(f"  lat: {float(ds.lat.min()):.2f}..{float(ds.lat.max()):.2f} n={ds.sizes['lat']}"
          f" step~{float(abs(np.diff(ds.lat.values[:2])[0])):.3f}")
    print(f"  lon: {float(ds.lon.min()):.2f}..{float(ds.lon.max()):.2f} n={ds.sizes['lon']}"
          f" step~{float(abs(np.diff(ds.lon.values[:2])[0])):.3f}")

    hr("3. Dask-backed open")
    dsd = xr.open_zarr(session.store, consolidated=False, chunks={})
    tpd = dsd["tp"]
    print(f"  dask chunk layout: {tpd.chunks}")
    print(f"  graph tasks for one init_date slice: "
          f"{len(tpd.isel(init_date=-1).__dask_graph__())}")

    target_date = args.date or str(dates.max().date())
    print(f"  timing target init_date: {target_date}")

    hr("4. Timing - 24h window accumulation, ensemble mean (Dask threads)")
    # tp is cumulative from init: window [0,24] = tp(24h) - tp(0h)
    i0 = int(np.argmin(np.abs(lead_h - 0)))
    i24 = int(np.argmin(np.abs(lead_h - 24)))
    print(f"  lead indices: 0h->{i0} ({lead_h[i0]}h), 24h->{i24} ({lead_h[i24]}h)")
    sel = tpd.sel(init_date=target_date).isel(lead_time=[i0, i24])
    t0 = time.perf_counter()
    window = (sel.isel(lead_time=1) - sel.isel(lead_time=0)).compute()  # (member, lat, lon)
    t_members = time.perf_counter() - t0
    print(f"  per-member window field computed in {t_members:.2f}s; "
          f"shape {window.shape}, {window.nbytes / 1e6:.1f} MB")
    t0 = time.perf_counter()
    mean = window.mean("member")
    t_mean = time.perf_counter() - t0
    vmax = float(mean.max())
    print(f"  ensemble mean in {t_mean:.3f}s; value range {float(mean.min()):.4f}.."
          f"{vmax:.4f} ({tp.attrs.get('units', 'units unknown')})")
    if vmax < 5:
        print("  NOTE: max < 5 -> values look like METERS; frontend rescale 0-100 assumes mm"
              " -> multiply by 1000 in the service.")
    else:
        print("  NOTE: values look like mm already.")

    hr("5. Timing - exceedance-style reduction (synthetic threshold)")
    thr = float(np.nanquantile(window.values, 0.9))
    t0 = time.perf_counter()
    exceed = (window > thr).sum("member") / window.sizes["member"]
    exceed = exceed.compute() if hasattr(exceed, "compute") else exceed
    print(f"  exceedance fraction in {time.perf_counter() - t0:.3f}s; "
          f"mean {float(exceed.mean()):.3f} (thr={thr:.4f})")

    hr("6. Timing - full-date load (worst case: all members x all leads)")
    t0 = time.perf_counter()
    full = tpd.sel(init_date=target_date).compute()
    print(f"  full (member,lead,lat,lon) load in {time.perf_counter() - t0:.2f}s; "
          f"{full.nbytes / 1e6:.0f} MB; RSS now {mem_mb():.0f} MB")

    hr("7. CMORPH thresholds file")
    found = [p for p in CMORPH_CANDIDATES if Path(p).exists()]
    if found:
        print(f"  FOUND: {found}")
    else:
        print("  NOT FOUND at any candidate path - M3 must source or synthesize thresholds:")
        for p in CMORPH_CANDIDATES:
            print(f"    - {p}")

    hr("Summary")
    print(f"  store: s3://{S3_BUCKET}/{S3_PREFIX} - OK (anonymous)")
    print(f"  per-(date,window) member field: {t_members:.2f}s cold; cacheable size "
          f"{window.nbytes / 1e6:.1f} MB")
    print(f"  final RSS: {mem_mb():.0f} MB")


if __name__ == "__main__":
    main()
