"""Per-date exceedance summaries for the calendar and regions feeds, persisted to disk."""

import json
import logging
import threading
from pathlib import Path

import numpy as np

from . import config, derive, emdat, regions, store

log = logging.getLogger(__name__)

SCHEMA_VERSION = 2

# date -> {"windows": {window_h: {"tp_max_mm": float, "rp": {rp: {"p", "members", "regions": {gid: p}}}}}}
_summaries: dict[str, dict] = {}
_lock = threading.Lock()
_builder_started = False
_active_date: str | None = None
_queue: list[str] = []  # dates requested while unsummarized, drained before the sweep
_failed: set[str] = set()


def _path() -> Path:
    return Path(config.CACHE_DIR) / "summaries.json"


def load_from_disk() -> None:
    global _summaries
    try:
        payload = json.loads(_path().read_text())
    except FileNotFoundError:
        _summaries = {}
        return
    except Exception:
        log.exception("summaries file unreadable, starting empty")
        _summaries = {}
        return
    if payload.get("version") != SCHEMA_VERSION:
        backup = _path().with_suffix(".v1.bak")
        _path().rename(backup)
        _summaries = {}
        log.warning("summaries schema outdated, moved to %s and rebuilding", backup)
        return
    _summaries = payload["dates"]
    log.info("summaries loaded: %d dates", len(_summaries))


def _save() -> None:
    _path().parent.mkdir(parents=True, exist_ok=True)
    _path().write_text(json.dumps({"version": SCHEMA_VERSION, "dates": _summaries}))


def _finite(value: float) -> float:
    """Coerce nan/inf to 0.0 so unfilled or gapped date slots stay JSON-serializable."""
    return float(value) if np.isfinite(value) else 0.0


def summarize_date(date: str) -> dict:
    """Domain-clipped exceedance and peak accumulation per (window, rp), with per-region maxima."""
    fields = derive.member_windows(date)
    domain = regions.domain_mask()
    gids = [m["gid"] for m in regions.meta()]
    windows: dict = {}
    for w in config.WINDOWS_H:
        mean_mm = fields[w].mean("member").values
        vals = mean_mm[domain] if domain is not None else mean_mm
        tp_max = _finite(np.nanmax(vals)) if np.isfinite(vals).any() else 0.0
        by_rp = {}
        for rp in config.RETURN_PERIODS:
            exceed = derive.exceedance_field(date, w, rp).values
            clipped = exceed[domain] if domain is not None else exceed
            p = _finite(np.nanmax(clipped)) if np.isfinite(clipped).any() else 0.0
            members = round(p * fields[w].sizes["member"])
            per_region = regions.region_max(exceed)
            region_p = {
                gid: round(float(v), 4) for gid, v in zip(gids, per_region) if v >= 0.0001
            }
            by_rp[str(rp)] = {"p": round(p, 4), "members": members, "regions": region_p}
        windows[str(w)] = {"tp_max_mm": round(tp_max, 1), "rp": by_rp}
    return {"windows": windows}


def has_date(date: str) -> bool:
    with _lock:
        return date in _summaries


def calendar_days(window_h: int, rp: int) -> list[dict]:
    """CalendarDay rows for every summarized date."""
    days = []
    with _lock:
        for date in sorted(_summaries):
            win = _summaries[date]["windows"].get(str(window_h))
            entry = win["rp"].get(str(rp)) if win else None
            if entry is None:
                continue
            days.append({
                "date": date,
                "p": entry["p"],
                "members": entry["members"],
                "tp_max_mm": win["tp_max_mm"],
                "emdat_match": emdat.matched(date),
            })
    return days


def region_rows(date: str, window_h: int, rp: int) -> list[dict] | None:
    """Full admin-1 breakdown for one summarized date; None when not summarized."""
    with _lock:
        win = _summaries.get(date, {}).get("windows", {}).get(str(window_h))
        entry = win["rp"].get(str(rp)) if win else None
        if entry is None:
            return None
        region_p = entry["regions"]
    return [
        {"shapeID": m["gid"], "shapeName": m["name"], "p": region_p.get(m["gid"], 0.0)}
        for m in regions.meta()
    ]


def region_peak(
    gids: list[str], window_h: int, rp: int, start: str | None = None, end: str | None = None
) -> dict | None:
    """Peak regional p among gids across summarized dates, optionally within [start, end]."""
    best: dict | None = None
    with _lock:
        for date in _summaries:
            if (start and date < start) or (end and date > end):
                continue
            win = _summaries[date]["windows"].get(str(window_h))
            entry = win["rp"].get(str(rp)) if win else None
            if entry is None:
                continue
            for gid in gids:
                p = entry["regions"].get(gid, 0.0)
                if best is None or p > best["p"]:
                    best = {"p": p, "date": date, "gid": gid}
    return best


def regions_batch(window_h: int, rp: int) -> dict[str, list[dict]]:
    """Region breakdowns for every summarized date in one payload."""
    with _lock:
        dates = sorted(_summaries)
    out = {}
    for date in dates:
        rows = region_rows(date, window_h, rp)
        if rows is not None:
            out[date] = rows
    return out


def request_date(date: str) -> None:
    """Prioritize a date for the builder; no-op when already summarized or queued."""
    with _lock:
        if date in _summaries or date in _queue or date in _failed:
            return
        _queue.append(date)
    log.info("summary requested for %s", date)


def progress() -> dict:
    total = len(store.init_dates())
    with _lock:
        return {"summarized": len(_summaries), "total_dates": total}


def status() -> dict:
    """Builder state for the frontend progress affordance."""
    total = len(store.init_dates())
    with _lock:
        return {
            "summarized": len(_summaries),
            "total": total,
            "active_date": _active_date,
            "dates": sorted(_summaries),
            "queued": list(_queue),
            "failed": sorted(_failed),
        }


def _next_date() -> str | None:
    with _lock:
        while _queue:
            date = _queue.pop(0)
            if date not in _summaries and date not in _failed:
                return date
        for date in reversed(store.init_dates()):
            if date not in _summaries and date not in _failed:
                return date
    return None


def start_builder() -> None:
    """Summarize dates in the background: requested dates first, then newest first."""
    global _builder_started
    if _builder_started or not derive.has_thresholds():
        if not derive.has_thresholds():
            log.warning("builder not started: thresholds missing")
        return
    _builder_started = True

    def run() -> None:
        global _active_date
        while (date := _next_date()) is not None:
            _active_date = date
            try:
                result = summarize_date(date)
            except Exception:
                log.exception("summary failed for %s", date)
                with _lock:
                    _failed.add(date)
                continue
            finally:
                _active_date = None
            with _lock:
                _summaries[date] = result
                _save()
                done = len(_summaries)
            log.info("summary built for %s (%d/%d)", date, done, len(store.init_dates()))
        log.info("summary builder done")

        # Warm the on-disk fields cache so any story date renders without an S3 derive.
        for date in reversed(store.init_dates()):
            if derive.has_fields(date):
                continue
            try:
                derive.member_windows(date)
            except Exception:
                log.exception("fields warm failed for %s", date)
        log.info("fields cache warm")

    threading.Thread(target=run, name="summary-builder", daemon=True).start()
