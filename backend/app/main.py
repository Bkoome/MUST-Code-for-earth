"""titiler-xarray: on-demand storymap tiles and feeds from the EA Icechunk store.

GET /health
GET /xr/dates                                  init dates in the store
GET /xr/info                                   store and service metadata
GET /xr/stats                                  cache and builder observability
GET /xr/status                                 summary builder progress and summarized dates
GET /xr/calendar?window=24h&rp=10yr            CalendarDay rows per summarized date
GET /xr/regions/{date}?window=24h&rp=10yr      admin-1 exceedance breakdown (202 while pending)
GET /xr/regions-batch?window=24h&rp=10yr       admin-1 breakdowns for all summarized dates
GET /xr/events/{date}                          recorded disaster events covering a day
GET /xr/catalogue                              catalogue provenance, sources, coverage gaps
GET /xr/moi?rp=10yr&year=2024                  anticipation, hazard attribution and the case ledger
GET /xr/moi/{date}?rp=10yr                     per-admin-1 verdicts for a day
GET /xr/moi/info                               evaluation parameters and impact-record coverage
GET /xr/observed/{date}?window=24h             per-admin-1 observed peak rainfall in mm
GET /xr/ensemble/{date}?window=24h&rp=10yr     per-member cumulative rainfall at the forecast hotspot
GET /xr/tiles/WebMercatorQuad/{z}/{x}/{y}.png  ?date=&layer=tp|exceedance|obs&window=&member=&rp=
"""

import logging
import time
from contextlib import asynccontextmanager
from datetime import date as date_cls

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from . import (catalogue, config, db, derive, emdat, imerg, moi, regions, store,
               summary, thresholds, tiles)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("titiler-xarray")

# Rendering contract shared with the frontend tile URL builders. Exceedance uses
# discrete probability classes; the first bin starts below 1/51 so a single-member
# signal still renders.
EXCEEDANCE_BINS = [
    [0.015, 0.05, [254, 217, 118, 255]],
    [0.05, 0.15, [254, 178, 76, 255]],
    [0.15, 0.30, [253, 141, 60, 255]],
    [0.30, 0.50, [240, 59, 32, 255]],
    [0.50, 1.001, [189, 0, 38, 255]],
]
LAYERS = {
    "tp": {"colormap_name": "blues", "rescale": (0.0, 100.0), "cutoff": 1.0},
    "exceedance": {"bins": EXCEEDANCE_BINS, "cutoff": 0.015},
    # Observed rainfall shares the tp scale so forecast and observation read alike.
    "obs": {"colormap_name": "blues", "rescale": (0.0, 100.0), "cutoff": 1.0},
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    store.start_dask()
    store.get_dataset()
    derive.set_thresholds(thresholds.load())
    imerg.load()
    regions.init()
    emdat.init()
    db.init()
    catalogue.init()
    moi.init()
    summary.load_from_disk()
    summary.start_builder()
    yield
    store.stop_dask()


app = FastAPI(title="titiler-xarray", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"]
)


@app.middleware("http")
async def timing(request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    if request.url.path.startswith("/xr"):
        query = f"?{request.url.query}" if request.url.query else ""
        log.info(
            "%s %s%s -> %s in %.3fs",
            request.method, request.url.path, query,
            response.status_code, time.perf_counter() - t0,
        )
    return response


def _parse_window(window: str) -> int:
    w = {"7d": 168}.get(window) or int(window.removesuffix("h"))
    if w not in config.WINDOWS_H:
        raise HTTPException(422, f"window must be one of {config.WINDOWS_H} hours (or '7d')")
    return w


def _parse_rp(rp: str) -> int:
    years = int(str(rp).removesuffix("yr"))
    if years not in config.RETURN_PERIODS:
        raise HTTPException(422, f"rp must be one of {config.RETURN_PERIODS}")
    return years


def _parse_date(date: str) -> None:
    """Reject a malformed date, so a typo 400s instead of reading as 'no events'."""
    try:
        date_cls.fromisoformat(date)
    except ValueError:
        raise HTTPException(400, f"date {date!r} is not an ISO date (YYYY-MM-DD)")


def _check_date(date: str) -> None:
    """Gate for routes that must read the raw member fields (tiles, ensemble)."""
    if date not in store.init_dates():
        raise HTTPException(400, f"init_date {date!r} not in store (see /xr/dates)")


def _require_thresholds() -> None:
    if not derive.has_thresholds():
        raise HTTPException(503, "exceedance disabled: thresholds not loaded")


def _layer_enabled(name: str) -> bool:
    if name == "exceedance":
        return derive.has_thresholds()
    if name == "obs":
        return imerg.available()
    return True


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/xr/dates")
def xr_dates():
    return {"dates": store.init_dates()}


@app.get("/xr/info")
def xr_info():
    ds = store.get_dataset()
    return {
        "store": (
            f"local:{config.LOCAL_STORE_PATH}" if config.LOCAL_STORE_PATH
            else f"s3://{config.S3_BUCKET}/{config.S3_PREFIX}"
        ),
        "dims": dict(ds.sizes),
        "bbox": [
            float(ds.lon.min()), float(ds.lat.min()),
            float(ds.lon.max()), float(ds.lat.max()),
        ],
        "windows_h": list(config.WINDOWS_H),
        "return_periods": list(config.RETURN_PERIODS),
        "members": ds["member"].values.tolist(),
        "layers": {
            name: {**spec, "enabled": _layer_enabled(name)}
            for name, spec in LAYERS.items()
        },
        "units": "mm (converted from store meters)",
    }


@app.get("/xr/stats")
def xr_stats():
    return derive.stats | {"cached_dates": derive.cached_dates(), "summary": summary.progress()}


@app.get("/xr/status")
def xr_status():
    return JSONResponse(summary.status(), headers={"Cache-Control": "no-store"})


@app.get("/xr/calendar")
def xr_calendar(window: str = Query("24h"), rp: str = Query("10yr")):
    _require_thresholds()
    return JSONResponse(
        {"data": summary.calendar_days(_parse_window(window), _parse_rp(rp))},
        headers={"Cache-Control": "public, max-age=60"},
    )


@app.get("/xr/catalogue")
def xr_catalogue():
    """Provenance and coverage of the disaster catalogue.

    Includes the crosswalk's own failure counts: an event placed on no region is
    invisible to every map view, so hiding that number would make a data gap
    look like an absence of disasters.
    """
    if not catalogue.available():
        raise HTTPException(503, "catalogue disabled: catalogue.sqlite not loaded")
    return {
        "meta": catalogue.meta(),
        "sources": catalogue.sources(),
        "manually_maintained": catalogue.unsupported_countries(),
    }


@app.get("/xr/moi")
def xr_moi(rp: str = Query("10yr"), year: int | None = Query(None)):
    """Anticipation, hazard attribution and the case ledger for one return period.

    All three reads travel together because none of them is safe to publish alone: the
    case ledger is five events, the attribution says most recorded floods were never in
    this hazard, and only the anticipation population is large enough to carry a rate.
    """
    if not moi.available():
        raise HTTPException(503, "moi disabled: evaluation tables not loaded")
    rp_y = _parse_rp(rp)
    return JSONResponse(
        {
            "rp": rp_y,
            "year": year,
            "anticipation": moi.anticipation(rp_y),
            "anticipation_year": moi.anticipation(rp_y, year) if year else None,
            "attribution": moi.attribution(),
            "cases": moi.cases(rp_y),
            "case_counts": moi.case_counts(),
            "days": moi.days(rp_y, year),
        },
        headers={"Cache-Control": "public, max-age=600"},
    )


@app.get("/xr/moi/info")
def xr_moi_info():
    """Evaluation parameters and the impact-record coverage that bounds every count."""
    if not moi.available():
        raise HTTPException(503, "moi disabled: evaluation tables not loaded")
    return {"meta": moi.meta(), "coverage": moi.coverage(), "verdicts": list(moi.VERDICTS)}


@app.get("/xr/moi/{date}")
def xr_moi_day(date: str, rp: str = Query("10yr")):
    """Per-admin-1 verdicts for one day: the map fill and the day card's outcome line."""
    if not moi.available():
        raise HTTPException(503, "moi disabled: evaluation tables not loaded")
    _parse_date(date)
    units = moi.day(date, _parse_rp(rp))
    return {"date": date, "rp": _parse_rp(rp), "count": len(units), "data": units}


@app.get("/xr/events/{date}")
def xr_events(date: str):
    """Recorded disaster events covering this day, with their admin-1 regions."""
    if not catalogue.available():
        raise HTTPException(503, "catalogue disabled: catalogue.sqlite not loaded")
    _parse_date(date)
    events = catalogue.events_on(date)
    return {"date": date, "count": len(events), "gids": catalogue.gids_on(date),
            "data": events}


@app.get("/xr/regions/{date}")
def xr_regions(request: Request, date: str, window: str = Query("24h"), rp: str = Query("10yr")):
    _require_thresholds()
    if not regions.available():
        raise HTTPException(503, "regions disabled: adm1 geojson not loaded")
    window_h, rp_y = _parse_window(window), _parse_rp(rp)

    # Summaries outlive the store window: summaries.json holds every date the
    # builder ever finished, so answer from it before asking what the store has.
    rows = summary.region_rows(date, window_h, rp_y)
    if rows is None:
        # Not summarized. Only a date the store still carries can be derived at
        # all, so that is where the store-membership gate belongs.
        _check_date(date)
        if date in derive.cached_dates():
            rows = regions.day_regions(date, window_h, rp_y)
    if rows is None:
        # Cold date: queue it for the builder instead of blocking on a full derive.
        summary.request_date(date)
        return JSONResponse({"status": "pending", "date": date}, status_code=202)

    etag = f'"v{summary.SCHEMA_VERSION}e2-{date}-{window_h}-{rp_y}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304)

    # Attach the ensemble signal per recorded event: peak over its span and on this run.
    match = emdat.match(date)
    if match:
        names = {m["gid"]: m["name"] for m in regions.meta()}
        for event in match["events"]:
            peak = summary.region_peak(event["gids"], window_h, rp_y, event["start"], event["end"])
            today = summary.region_peak(event["gids"], window_h, rp_y, date, date)
            event["signal"] = (
                {"p": round(peak["p"], 4), "date": peak["date"], "region": names.get(peak["gid"])}
                if peak else None
            )
            event["signal_today"] = (
                {"p": round(today["p"], 4), "region": names.get(today["gid"])} if today else None
            )

    return JSONResponse(
        {"regions": rows, "emdat": match},
        headers={"Cache-Control": "public, max-age=3600", "ETag": etag},
    )


@app.get("/xr/regions-batch")
def xr_regions_batch(window: str = Query("24h"), rp: str = Query("10yr")):
    _require_thresholds()
    if not regions.available():
        raise HTTPException(503, "regions disabled: adm1 geojson not loaded")
    return JSONResponse(
        {"data": summary.regions_batch(_parse_window(window), _parse_rp(rp))},
        headers={"Cache-Control": "public, max-age=300"},
    )


@app.get("/xr/observed/{date}")
def xr_observed(date: str, window: str = Query("24h")):
    """Per-admin-1 observed peak rainfall in mm for the window; empty when obs is unavailable."""
    window_h = _parse_window(window)
    field = imerg.observed_window(date, window_h) if imerg.available() else None
    if field is None or not regions.available():
        return JSONResponse({"date": date, "window_h": window_h, "available": False, "regions": {}})
    per_region = regions.region_max(field.values)
    rows = {m["gid"]: round(float(v), 1) for m, v in zip(regions.meta(), per_region)}
    return JSONResponse(
        {"date": date, "window_h": window_h, "available": True, "regions": rows},
        headers={"Cache-Control": "public, max-age=60"},
    )


@app.get("/xr/ensemble/{date}")
def xr_ensemble(date: str, window: str = Query("24h"), rp: str = Query("10yr")):
    """Per-member cumulative rainfall at the forecast hotspot for the storymap chart.

    202 while the date's fields are still building, mirroring /xr/regions."""
    _check_date(date)
    _require_thresholds()
    window_h, rp_y = _parse_window(window), _parse_rp(rp)
    if not derive.has_fields(date) and date not in derive.cached_dates():
        summary.request_date(date)
        return JSONResponse({"status": "pending", "date": date}, status_code=202)
    return JSONResponse(
        derive.ensemble_trajectory(date, window_h, rp_y),
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.get("/xr/tiles/WebMercatorQuad/{z}/{x}/{y}.png")
def xr_tile(
    z: int,
    x: int,
    y: int,
    date: str = Query(..., description="init date YYYY-MM-DD"),
    layer: str = Query("tp", pattern="^(tp|exceedance|obs)$"),
    window: str = Query("24h", description="3h|6h|12h|24h|48h|72h|168h|7d"),
    member: str = Query("mean", description="'mean', 'control', or 'ens_NN'"),
    rp: str | None = Query(None, description="return period years (exceedance)"),
):
    _check_date(date)
    window_h = _parse_window(window)

    if layer == "exceedance":
        _require_thresholds()
        if rp is None:
            raise HTTPException(422, "rp is required for the exceedance layer")
        field = derive.exceedance_field(date, window_h, _parse_rp(rp))
    elif layer == "obs":
        if not imerg.available():
            raise HTTPException(503, "observation disabled: imerg not loaded")
        field = imerg.observed_window(date, window_h)
        if field is None:
            raise HTTPException(404, f"no imerg observation for {date} at {window}")
    else:
        field = derive.tp_field(date, window_h, member)
    field = regions.clip_to_domain(field)

    try:
        png = tiles.render_tile(field, z, x, y, **LAYERS[layer])
    except tiles.TileOutsideBounds:
        return Response(status_code=204)

    return Response(
        png,
        media_type="image/png",
        headers={"Cache-Control": f"public, max-age={config.TILE_MAX_AGE}"},
    )
