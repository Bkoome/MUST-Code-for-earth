"""Icechunk store access + local Dask scheduler, shared across requests.

One readonly icechunk session and one Dask-backed xr.Dataset live for the
process lifetime; every derivation computes through the local Dask scheduler
started here (in-process LocalCluster with a memory limit by default, plain
threaded scheduler as fallback).
"""

import logging
import threading

import icechunk
import numpy as np
import pandas as pd
import psutil
import xarray as xr

from . import config

log = logging.getLogger(__name__)

_lock = threading.Lock()
_ds: xr.Dataset | None = None
_client = None
_lead_hours: np.ndarray | None = None


def start_dask() -> str:
    """Start the local Dask scheduler; returns a description for logs."""
    global _client
    if config.DASK_SCHEDULER == "distributed":
        try:
            from dask.distributed import Client, LocalCluster

            mem_limit = int(psutil.virtual_memory().total * config.DASK_MEM_FRACTION)
            cluster = LocalCluster(
                processes=False,
                n_workers=1,
                threads_per_worker=config.DASK_THREADS,
                memory_limit=mem_limit,
                dashboard_address=None,
            )
            _client = Client(cluster)
            desc = (
                f"distributed LocalCluster in-process: {config.DASK_THREADS} threads, "
                f"memory_limit={mem_limit / 1e9:.1f} GB "
                f"({config.DASK_MEM_FRACTION:.0%} of RAM)"
            )
            log.info("dask: %s", desc)
            return desc
        except Exception:
            log.exception("dask: LocalCluster failed, falling back to threaded scheduler")
    import dask

    dask.config.set(scheduler="threads", num_workers=config.DASK_THREADS)
    desc = f"threaded scheduler: {config.DASK_THREADS} threads (no hard memory limit)"
    log.info("dask: %s", desc)
    return desc


def stop_dask() -> None:
    global _client
    if _client is not None:
        cluster = _client.cluster
        _client.close()
        if cluster is not None:
            cluster.close()
        _client = None


def get_dataset() -> xr.Dataset:
    """The Dask-backed dataset (opened once, ~5 s; thread-safe)."""
    global _ds
    if _ds is None:
        with _lock:
            if _ds is None:
                if config.LOCAL_STORE_PATH:
                    storage = icechunk.local_filesystem_storage(config.LOCAL_STORE_PATH)
                    source = f"local:{config.LOCAL_STORE_PATH}"
                else:
                    storage = icechunk.s3_storage(
                        bucket=config.S3_BUCKET,
                        prefix=config.S3_PREFIX,
                        region=config.S3_REGION,
                        anonymous=True,
                    )
                    source = f"s3://{config.S3_BUCKET}/{config.S3_PREFIX}"
                repo = icechunk.Repository.open(storage)
                session = repo.readonly_session("main")
                _ds = xr.open_zarr(session.store, consolidated=False, chunks={})
                log.info("store open: %s dims=%s", source, dict(_ds.sizes))
    return _ds


def lead_hours() -> np.ndarray:
    """lead_time axis as integer hours (stored as plain ints, not timedelta)."""
    global _lead_hours
    if _lead_hours is None:
        vals = get_dataset()["lead_time"].values
        if np.issubdtype(vals.dtype, np.timedelta64):
            vals = vals / np.timedelta64(1, "h")
        _lead_hours = vals.astype(int)
    return _lead_hours


def init_dates() -> list[str]:
    """Available forecast init dates as YYYY-MM-DD, ascending."""
    dates = pd.to_datetime(get_dataset()["init_date"].values)
    return [d.strftime("%Y-%m-%d") for d in sorted(dates)]
