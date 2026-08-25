"""Env-driven settings for the titiler-xarray service.

Every tuning knob lives here: store location, Dask scheduler threads and memory
fraction, derived-field cache size, and the optional data files that gate the
exceedance, observation, region, and EM-DAT features.
"""

import os

# EA total-precipitation Icechunk store on source.coop (anonymous read).
S3_BUCKET = os.getenv("XR_S3_BUCKET", "us-west-2.opendata.source.coop")
S3_PREFIX = os.getenv("XR_S3_PREFIX", "e4drr-project/forecasts/ecmwf_ea_tp_icechunk")
S3_REGION = os.getenv("XR_S3_REGION", "us-west-2")

# Local materialized Icechunk store path; overrides the S3 store when set.
LOCAL_STORE_PATH = os.getenv("XR_LOCAL_STORE_PATH", "")

# Chunk fetch is network-bound, so Dask threads default above core count.
DASK_THREADS = int(os.getenv("XR_DASK_THREADS", "12"))
# Fraction of the memory budget the in-process Dask worker may use before
# spilling — the cgroup limit when containerized, host RAM otherwise.
DASK_MEM_FRACTION = float(os.getenv("XR_DASK_MEM_FRACTION", "0.5"))
# "distributed" (LocalCluster, hard memory limit) or "threads".
DASK_SCHEDULER = os.getenv("XR_DASK_SCHEDULER", "distributed")

# Derived-field LRU size, in init_dates (~32 MB of member fields per date).
CACHE_DATES = int(os.getenv("XR_CACHE_DATES", "4"))

# Tiles are immutable per init_date, so long client caching is safe.
TILE_MAX_AGE = int(os.getenv("XR_TILE_MAX_AGE", "86400"))

# CMORPH return-period thresholds (NetCDF/zarr path or URL); empty disables exceedance.
CMORPH_THRESHOLDS_URL = os.getenv("CMORPH_THRESHOLDS_URL", "")

# GPM IMERG daily observed rainfall (NetCDF/zarr); empty disables the obs layer.
IMERG_DAILY_URL = os.getenv("IMERG_DAILY_URL", "/data/gpm_imerg_ea_daily.nc")

# Admin-1 polygons for the regions endpoint.
ADM1_GEOJSON = os.getenv("XR_ADM1_GEOJSON", "/data/ea-adm1-geo.json")

# Parsed EM-DAT flood events for calendar/regions matching; empty file disables it.
EMDAT_FLOODS = os.getenv("XR_EMDAT_FLOODS", "/data/emdat_ea_floods.json")

# Writable dir for persisted per-date summaries (calendar feed).
CACHE_DIR = os.getenv("XR_CACHE_DIR", "/cache")

# Accumulation windows [0, w] hours and CMORPH return periods (years).
WINDOWS_H = (3, 6, 12, 24, 48, 72, 168)
RETURN_PERIODS = (2, 5, 10, 20, 50, 100)
