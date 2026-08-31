#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["earthaccess", "xarray", "h5netcdf", "h5py", "numpy", "pandas"]
# ///
"""Pull GPM IMERG daily observed rainfall for East Africa into a NetCDF the backend bundles.

Fetches GPM_3IMERGDF (Final, gauge-calibrated) daily precipitation over the EA
bbox for the date range spanning the cached forecast init dates plus a 6-day
tail (168h windows), and writes data/gpm_imerg_ea_daily.nc. Dates missing a Final
granule fall back to GPM_3IMERGDL (Late run) and are tagged.

Auth: an Earthdata Login via ~/.netrc (machine urs.earthdata.nasa.gov) or the
EARTHDATA_USERNAME / EARTHDATA_PASSWORD environment variables.

Usage: uv run pull_imerg.py [--start YYYY-MM-DD --end YYYY-MM-DD]
"""

import argparse
import os
import sys
import tempfile
from pathlib import Path

import earthaccess
import numpy as np
import pandas as pd
import xarray as xr

# ICPAC / East Africa domain, aligned with data/ea-adm1-geo.json.
EA_BBOX = (21.84, -11.75, 51.42, 23.15)  # west, south, east, north

HERE = Path(__file__).resolve()
CACHE_FIELDS = HERE.parents[2] / "cache" / "fields"
OUT = HERE.parents[2] / "data" / "gpm_imerg_ea_daily.nc"

FINAL = ("GPM_3IMERGDF", "Final")
LATE = ("GPM_3IMERGDL", "Late")


def _needed_days() -> list[str]:
    """Union of each cached init date and its 6-day tail (168h window), sorted."""
    inits = sorted(p.stem for p in CACHE_FIELDS.glob("*.npz"))
    if not inits:
        sys.exit(f"no cached dates in {CACHE_FIELDS}; pass --start/--end")
    days = {
        (pd.Timestamp(d) + pd.Timedelta(days=i)).strftime("%Y-%m-%d")
        for d in inits for i in range(7)
    }
    return sorted(days)


def _day(date: str, short_name: str, tmp: str) -> xr.DataArray | None:
    """EA-subset daily precip for one date and product, or None when no granule."""
    results = earthaccess.search_data(
        short_name=short_name, version="07",
        temporal=(f"{date} 00:00:00", f"{date} 23:59:59"),
        bounding_box=EA_BBOX,
    )
    if not results:
        return None
    # Download beats range-streaming here: the daily .nc4 granules are small and
    # GES DISC range requests are flaky. Variables sit at the file root.
    path = earthaccess.download(results, tmp)[0]
    ds = xr.open_dataset(path, engine="h5netcdf")
    if "lat" not in ds.dims:
        ds = ds.rename({"latitude": "lat", "longitude": "lon"})
    w, s, e, n = EA_BBOX
    da = ds["precipitation"].sel(lat=slice(s, n), lon=slice(w, e)).transpose("time", "lat", "lon")
    return da.load()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", help="override: contiguous range start YYYY-MM-DD")
    ap.add_argument("--end", help="override: contiguous range end YYYY-MM-DD")
    ap.add_argument("--out", type=Path, default=OUT, help="output NetCDF path")
    args = ap.parse_args()

    # Prefer explicit env credentials, else fall back to ~/.netrc.
    strategy = "environment" if "EARTHDATA_USERNAME" in os.environ else "netrc"
    earthaccess.login(strategy=strategy)

    if args.start and args.end:
        days = list(pd.date_range(args.start, args.end, freq="D").strftime("%Y-%m-%d"))
    else:
        days = _needed_days()
    fields, runs = [], []
    with tempfile.TemporaryDirectory() as tmp:
        for date in days:
            da = _day(date, FINAL[0], tmp)
            run = FINAL[1]
            if da is None:
                da = _day(date, LATE[0], tmp)
                run = LATE[1]
            if da is None:
                print(f"  {date}: no granule (skipped)")
                continue
            fields.append(da)
            runs.append(run)
            print(f"  {date}: {run}")

    if not fields:
        sys.exit("no IMERG granules fetched; check credentials and date range")

    out = xr.concat(fields, dim="time")
    out.attrs["units"] = "mm"
    out.attrs["source"] = "GPM IMERG v07 daily (GPM_3IMERGDF Final, GPM_3IMERGDL Late fallback)"
    out.attrs["runs"] = ",".join(sorted(set(runs)))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    out.to_dataset(name="precipitation").to_netcdf(args.out)
    print(f"wrote {args.out} ({len(fields)} days, {np.datetime_as_string(out.time.min().values, unit='D')}"
          f"..{np.datetime_as_string(out.time.max().values, unit='D')})")


if __name__ == "__main__":
    main()
