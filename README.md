# MUST

Monitoring and Understanding SpatioTemporal Flood Risk. Retrospective flood-risk
monitoring and decision support for East Africa, driven by the ECMWF IFS
ensemble. One application, two components: a Next.js frontend and an on-demand
xarray/Icechunk tile backend, wired together by Docker Compose. It streams the
published store from source.coop out of the box, or runs fully offline against a
materialized local store (see [Local dataset](#local-dataset)).

Part of ECMWF Code for Earth 2026, Africa Stream (ArcX), Challenge 41.

## Structure

```
must/
  docker-compose.yml     runs both components
  .env.example           copy to .env before compose
  frontend/              Next.js 14 app (calendar index + storymap)
    app/                 App Router pages, components, state, styles
    public/              map geometry, story assets, banner
    Dockerfile
  backend/               titiler-xarray service
    app/                 FastAPI service (tp accumulation, ensemble exceedance)
    data/                admin-1 polygons, EM-DAT events, NetCDF bundles*
    store-local/*        materialized EA tp Icechunk store
    cache/*              derived-field cache and calendar summary feed
    tools/               scripts that produced the EM-DAT and IMERG datasets
    verify_store.py      standalone store and timing check
    Dockerfile
```

`*` not in git — see [Local dataset](#local-dataset).

No pgstac, PostGIS, or COG pipeline. The frontend talks only to the tiler over
`/xr/*`, and the tiler needs no database.

## Data flow

```
Browser -> frontend :3000 -> titiler-xarray :8090 -> Icechunk store
```

The frontend builds tile and data URLs from `NEXT_PUBLIC_TILER_XR_BASE`. The
backend derives fields per request through an in-process Dask scheduler,
streaming the published store from source.coop by default or reading a
materialized local store when `XR_LOCAL_STORE_PATH` is set.

## Run with Docker

```
cp .env.example .env
make up          # or: docker compose up -d --build
```

`make` targets: `up`, `down`, `restart`, `logs`, `ps`, `build`.

Frontend on http://localhost:3000, backend on http://localhost:8090. First
backend start opens the Icechunk session and warms Dask, allow about 30s. Check
it:

```
curl -sf http://localhost:8090/health
curl -sf http://localhost:8090/xr/dates
```

## Run without Docker

Backend:

```
cd backend
pip install -r requirements.txt
XR_ADM1_GEOJSON="$PWD/data/ea-adm1-geo.json" \
XR_EMDAT_FLOODS="$PWD/data/emdat_ea_floods.json" \
XR_CACHE_DIR="$PWD/cache" \
uvicorn app.main:app --host 0.0.0.0 --port 8090
```

Add `XR_LOCAL_STORE_PATH="$PWD/store-local"` and
`CMORPH_THRESHOLDS_URL="$PWD/data/cmorph_ea_return_periods.nc"` once those files
are in place; without them the backend streams from source.coop and serves the
`tp` layer only.

Frontend:

```
cd frontend
yarn install
cp .env.example .env.local          # set NEXT_PUBLIC_TILER_XR_BASE=http://localhost:8090
yarn dev
```

## Configuration

Copy `.env.example` to `.env`. Key variables:

- `NEXT_PUBLIC_TILER_XR_BASE`: browser-facing tiler URL, inlined at build time.
  Behind a proxy set the public tiler URL and rebuild the frontend image.
- `XR_LOCAL_STORE_PATH`: empty (the default) streams from source.coop; `/store`
  reads a materialized local store from `backend/store-local/`.
- `CMORPH_THRESHOLDS_URL`: return-period thresholds file; empty disables the
  exceedance layer.
- `IMERG_DAILY_URL`: GPM IMERG daily rainfall file; empty disables the obs layer.
- `XR_DASK_THREADS`, `XR_DASK_MEM_FRACTION`, `XR_DASK_SCHEDULER`,
  `XR_CACHE_DATES`: local Dask scheduler and field-cache tuning.

Full list with defaults lives in `backend/app/config.py`.

## Backend endpoints

- `GET /health`: liveness
- `GET /xr/dates`: init dates in the store
- `GET /xr/info`: dims, bbox, windows, return periods, members, layers
- `GET /xr/stats`: derive stats, cache occupancy, builder progress
- `GET /xr/status`: summary-builder progress
- `GET /xr/calendar?window=&rp=`: per-day exceedance ramp
- `GET /xr/regions/{date}?window=&rp=`: admin-1 rows plus matched EM-DAT event
- `GET /xr/regions-batch?window=&rp=`: admin-1 rows for every day
- `GET /xr/observed/{date}?window=`: per-admin-1 observed peak rainfall in mm
- `GET /xr/ensemble/{date}?window=&rp=`: per-member cumulative rainfall at the
  forecast hotspot
- `GET /xr/tiles/WebMercatorQuad/{z}/{x}/{y}.png`: `date`, `layer=tp|exceedance|obs`,
  `window`, `member`, `rp`

`/xr/regions/{date}` and `/xr/ensemble/{date}` answer `202` while the background
builder is still deriving that day; poll until they return `200`.

`window` is one of `3h 6h 12h 24h 48h 72h 168h` (`7d` alias). `rp` is one of
`2 5 10 20 50 100` years. The `obs` layer serves GPM IMERG observed rainfall and
only supports whole-day windows (24/48/72/168h).

## Observation layer (GPM IMERG)

The storymap's second chapter shows observed rainfall from GPM IMERG daily
(GPM_3IMERGDF v07, Final run), summed over the same window as the forecast and
regridded to the store grid. The backend reads a local NetCDF (not in git);
empty `IMERG_DAILY_URL` disables the layer.

Refresh or extend the bundle (needs a NASA Earthdata Login via `~/.netrc` or
`EARTHDATA_USERNAME`/`EARTHDATA_PASSWORD`):

```
cd backend
uv run tools/imerg/pull_imerg.py     # writes data/gpm_imerg_ea_daily.nc
```

By default it pulls the days spanning the cached forecast dates plus a 6-day
tail. Pass `--start`/`--end` for a custom range.

## Local dataset

The offline bundle covers the cached 2024 and 2026 flood windows. Only the small
vector files are in git; everything else is generated or downloaded, so a fresh
clone needs the steps below before the fully offline path works.

In git:

- `backend/data/ea-adm1-geo.json`: admin-1 polygons (regions endpoint, storymap).
- `backend/data/emdat_ea_floods.json`: parsed EA flood events. Regenerate from a
  fresh EM-DAT export with `backend/tools/emdat/`. The raw export itself is not
  redistributable and stays out of git.

Not in git:

- `backend/store-local/`: materialized EA tp Icechunk store, about 1.2 GB. Leave
  `XR_LOCAL_STORE_PATH` empty to stream the published store from source.coop
  instead; the stack then runs without it, just slower and online.
- `backend/cache/`: derived fields and calendar summaries. Created on first run;
  the backend rebuilds it in the background.
- `backend/data/cmorph_ea_return_periods.nc`: return-period thresholds, ~330 MB.
  Without it the exceedance layer and calendar stay disabled.
- `backend/data/gpm_imerg_ea_daily.nc`: observed rainfall, ~10 MB. Rebuild with
  `uv run tools/imerg/pull_imerg.py` (see the observation-layer section above).
  Without it the observation layer stays disabled.

Verify store access and derivation timing from `backend/`:

```
uv run verify_store.py
```

## Deployment notes

Both services publish to `127.0.0.1` only. Put a reverse proxy in front, route
`/` to `frontend:3000` and the tiler host to `titiler-xarray:8000`, and
terminate TLS there. The tiler origin must be reachable from clients and allow
CORS from the site origin.

## Production compute

Locally the derivation runs on an in-process Dask scheduler against a local or
streamed store. In production the same code streams the Icechunk virtual dataset
of the ECMWF IFS open-data archive from AWS S3 in eu-central-1 (Frankfurt),
realized by a Dask cluster provisioned in the same region with Coiled.

The Missed Opportunity Index needs repeated analysis over more than 1,000 days of
IFS forecasts, mainly total precipitation, covering 18 January 2023 to present as
new forecasts publish. Region-local compute is the design constraint: streaming
the store is network-bound, so the cluster must sit next to the S3 objects.
Moving from local to production changes only the store path and the Dask client
target in `backend/app/store.py`; the endpoints are agnostic to where the field
came from.

## Development

```
cd frontend
yarn install
yarn check        # tsc --noEmit + next lint
yarn format       # prettier
```

`pre-commit install` wires the same checks, plus whitespace/large-file/private-key
guards, into commits. CI runs the frontend checks and byte-compiles the backend.

## License

Apache 2.0. See `LICENSE`.
