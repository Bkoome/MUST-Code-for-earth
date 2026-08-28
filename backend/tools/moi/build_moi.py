#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["icechunk", "xarray", "zarr", "rasterio", "numpy", "netCDF4", "dask"]
# ///
"""Build data/moi.sqlite: what MUST anticipated, and what it was never able to.

    uv run build_moi.py                  # build from the fields cache
    uv run build_moi.py --summary        # build, then print the contingency tables

Three populations are written, and keeping them apart is the whole point of the
tool. A rainfall-extreme forecast archive scored against a flood-loss database
will read as a warning scorecard unless the boundary between them is carried in
the data:

  obs_extreme + signal   Every region-day where IMERG observed an unusual
                         rainfall event, and what the ensemble said about it at
                         each lead. Needs no disaster record, so it covers every
                         admin-1 unit and every day in the archive. This is the
                         population MUST can actually be verified on.

  impact_event           Recorded floods, each tiered by whether it is inside
                         MUST's hazard at all. Most are not: a flood routed from
                         upstream highlands, or a drainage failure in a city,
                         leaves no rainfall extreme in the unit it damages. Those
                         are not forecast failures and are never scored as one.

  moi_case               The intersection — impact recorded AND an unusual
                         rainfall event observed — which is the only place the
                         phrase "missed opportunity" carries meaning.

Inputs, all of them already built by something else:

  fields cache   cache/fields/<init_date>.npz, per-member [0,w] accumulations
                 written by app/derive.py. Lead-day accumulations come out of
                 these by subtraction, so the whole signal side costs no store
                 read at all.
  thresholds     data/cmorph_ea_return_periods.nc, the 24 h return levels
  imerg          data/gpm_imerg_ea_daily.nc, observed daily rainfall
  catalogue      data/catalogue.sqlite, built by tools/catalogue/build_catalogue.py
  store          the Icechunk store, opened only for its lat/lon/member axes so
                 the masks, thresholds and observations land on the same grid the
                 service uses

The store is opened read-only and no field is ever computed from it here.
"""

import argparse
import json
import sqlite3
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import xarray as xr
from rasterio import features
from rasterio.transform import from_origin

HERE = Path(__file__).parent
BACKEND = HERE.parent.parent

SCHEMA_VERSION = "1"

# --- the parameters every verdict in the file depends on ---------------------

# A signal is "qualifying" when this fraction of the ensemble clears the return
# level. 0.15 is not a new constant: it is the Moderate boundary the frontend
# already draws at in types/contract.ts severityState(), so the calendar's colour
# and this file's verdict cannot disagree about what counts as a strong day.
STRONG_P = 0.15

# The confirmation bar, fixed and deliberately NOT tied to the forecast return
# period. The observation answers "did something unusual actually fall?", which
# is a different question from "was it as rare as the thing we warned about".
# Tying the two collapses the assessable population to almost nothing: at a
# matched 10-yr bar, IMERG confirms 194 region-days in three and a half years.
OBS_RP = 2

# Lead days resolvable from the store. Its lead axis is [0,3,6,12,24,48,72,168],
# so 24 h accumulations exist for day 0, 1 and 2 only — 72->168 h is one
# four-day block and no daily total can be recovered from it.
LEAD_DAYS = (0, 1, 2)

# DesInventar dates the day flooding was noticed, which is often the morning
# after the rain. Both the signal and the observation are looked for across the
# event span widened by this much at each end.
JOIN_TOLERANCE_DAYS = 1

# A record longer than this is a season, not a day's event. Scoring one means
# asking whether any signal appeared anywhere in two months, which is not a
# question about anticipation. app/catalogue.py uses 92 days to demote such
# records in the reader's ledger; scoring needs a far tighter bound.
MAX_SCORED_SPAN_DAYS = 7

# EM-DAT is excluded from scoring by design. Its admin-1 links are prose matches
# expanded from named macro-regions — 36 events carry 326 unit links between
# them — which is fine for a reader's ledger and useless as ground truth for a
# per-unit verdict.
IMPACT_SOURCE = "desinventar"

# Keep a signal row when any lead reaches one member out of the ensemble. Below
# that there is nothing to say, and the table would carry a row per unit per day.
SIGNAL_FLOOR_MEMBERS = 1


def iso(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def load_grid(store_path: Path) -> tuple[np.ndarray, np.ndarray, int]:
    """The store's lat/lon axes and ensemble size, and nothing else from it.

    Everything downstream — the admin-1 masks, the interpolated thresholds, the
    regridded observations — has to land on exactly the grid the service derives
    on, or a region's cells stop meaning the same thing in this file as they do
    in a tile. Reading the axes from the store itself is the only way to be sure
    of that; no field is loaded and nothing is computed.
    """
    import icechunk

    storage = icechunk.local_filesystem_storage(str(store_path))
    ds = xr.open_zarr(icechunk.Repository.open(storage).readonly_session("main").store,
                      consolidated=False, chunks={})
    return ds.lat.values, ds.lon.values, int(ds.sizes["member"])


def region_masks(adm1: Path, lat: np.ndarray, lon: np.ndarray) -> tuple[list, list[dict]]:
    """Flat cell indices per admin-1 unit, rasterized one polygon at a time.

    Mirrors app/regions.py exactly, including why it cannot be one rasterize()
    call: that writes shapes in list order, so with all_touched a later polygon
    overwrites an earlier one in every cell they share and a small unit beside a
    large one ends up with no cells at all. Regions are allowed to overlap.
    """
    gj = json.loads(adm1.read_text())
    res = float(abs(lat[1] - lat[0]))
    transform = from_origin(lon.min() - res / 2, lat.max() + res / 2, res, res)
    shape = (lat.size, lon.size)
    flip = lat[0] < lat[-1]  # rasterize is north-up; flip to match ascending lat

    cells, meta, empty = [], [], []
    for f in gj["features"]:
        mask = features.rasterize([(f["geometry"], 1)], out_shape=shape,
                                  transform=transform, fill=0, all_touched=True).astype(bool)
        if flip:
            mask = np.flipud(mask)
        if not mask.any():
            empty.append(f["properties"]["name"])
        cells.append(np.flatnonzero(mask))
        p = f["properties"]
        meta.append({"gid": p["gid"], "iso3": p["iso"], "name": p["name"]})
    if empty:
        print(f"  ! {len(empty)} unit(s) cover no grid cell and will read 0.0: "
              f"{', '.join(empty)}", file=sys.stderr)
    return cells, meta


def region_max(field: np.ndarray, cells: list) -> np.ndarray:
    """Max value per unit, gathering each unit's own cells. NaN reads as 0.0."""
    flat = np.nan_to_num(field, nan=0.0).ravel()
    out = np.zeros(len(cells), dtype="float64")
    for i, idx in enumerate(cells):
        if idx.size:
            out[i] = flat[idx].max()
    return out


def load_thresholds(path: Path, lat: np.ndarray, lon: np.ndarray) -> dict[int, np.ndarray]:
    """24 h return levels in mm per return period, on the store grid.

    Only the 24 h duration is used. The whole index is a statement about daily
    accumulations — a lead *day*, an observed *day*, a recorded event *date* —
    and mixing durations into that would make the verdict unreadable.
    """
    da = xr.open_dataset(path)["return_period_precip"].sel(duration="24hr")
    da = da.interp(lat=lat, lon=lon, method="linear")
    if str(da.attrs.get("units", "mm")).lower() in ("m", "meter", "metre", "meters", "metres"):
        da = da * 1000.0
    da = da.astype("float32").load()
    return {int(rp): da.sel(return_period=rp).values for rp in da["return_period"].values}


def load_imerg(path: Path, lat: np.ndarray, lon: np.ndarray) -> dict[str, np.ndarray]:
    """Observed daily rainfall in mm keyed by day, on the store grid."""
    ds = xr.open_dataset(path)
    da = ds["precipitation"]
    if "lat" not in da.dims or "lon" not in da.dims:
        da = da.rename({"latitude": "lat", "longitude": "lon"})
    da = da.transpose("time", "lat", "lon").assign_coords(time=da["time"].dt.floor("D"))
    da = da.interp(lat=lat, lon=lon, method="linear")
    if str(da.attrs.get("units", "mm")).lower() in ("m", "meter", "metre", "meters", "metres"):
        da = da * 1000.0
    da = da.astype("float32").load()
    days = np.datetime_as_string(da["time"].values, unit="D")
    return {str(d): da.isel(time=i).values for i, d in enumerate(days)}


def build_observations(imerg, thr, cells, meta, valid_days: set[str]) -> dict:
    """Per region-day: the observed peak, and the highest return level it cleared.

    A unit counts as confirmed when at least one of its cells observed a total at
    or above the return level *for that cell*. Taking the unit maximum of the
    observation and comparing it to the unit maximum of the threshold would
    compare a wet cell against a dry cell's return level, which is not the same
    question and is much easier to pass.

    Only days the archive could have forecast are kept. IMERG runs months past
    the last run in the store, and an extreme no forecast existed for is not a
    miss — counting it as one would charge the ensemble for days it never saw.
    """
    rps = sorted(thr)
    obs: dict[tuple[str, str], dict] = {}
    peaks: dict[str, np.ndarray] = {}  # every unit's peak, extreme or not
    for day, field in imerg.items():
        if day not in valid_days:
            continue
        peak = region_max(field, cells)
        peaks[day] = peak.astype("float32")
        cleared = np.zeros(len(cells), dtype=int)
        for rp in rps:
            hit = region_max((field >= thr[rp]).astype("float32"), cells) > 0
            cleared = np.where(hit, rp, cleared)
        for i, m in enumerate(meta):
            if cleared[i] >= OBS_RP:
                obs[(day, m["gid"])] = {"obs_mm": round(float(peak[i]), 1),
                                        "rp_cleared": int(cleared[i])}
    return obs, peaks


def build_signal(fields_dir: Path, thr, cells, meta, members: int):
    """Per (valid day, unit, return period): exceedance at lead day 0, 1 and 2.

    The lead-day accumulation is a subtraction, not a new derivation. The cache
    holds [0,w] totals per member, so the 24 h falling on lead day k is
    W(24(k+1)) - W(24k); clipped at zero because float32 rounding puts a handful
    of cells a hair below it. A run initialized k days before the day in question
    was issued at least 24k hours ahead of it, which is what makes lead 1 and 2
    the actionable ones.
    """
    rps = sorted(thr)
    sig: dict[tuple[str, str, int], dict] = defaultdict(dict)
    computed: set[tuple[str, int]] = set()  # (valid day, lead) pairs a run actually covered
    unreadable = []
    files = sorted(fields_dir.glob("*.npz"))
    for n, f in enumerate(files):
        init = f.stem
        try:
            with np.load(f) as z:
                w = {k: z[k] for k in ("24", "48", "72")}
        except Exception as exc:  # a truncated write, not a forecast with no signal
            unreadable.append((init, type(exc).__name__))
            continue
        acc = {0: w["24"],
               1: np.clip(w["48"] - w["24"], 0, None),
               2: np.clip(w["72"] - w["48"], 0, None)}
        for k in LEAD_DAYS:
            valid = iso(date.fromisoformat(init) + timedelta(days=k))
            computed.add((valid, k))
            for rp in rps:
                p = region_max((acc[k] > thr[rp]).sum(0) / members, cells)
                for i, m in enumerate(meta):
                    if p[i] > 0:
                        sig[(valid, m["gid"], rp)][k] = round(float(p[i]), 4)
        if n % 200 == 0:
            print(f"  fields {n}/{len(files)} {init}", flush=True)
    if unreadable:
        print(f"  ! {len(unreadable)} unreadable field file(s), left as NULL signal: "
              f"{', '.join(d for d, _ in unreadable)}", file=sys.stderr)
    return sig, computed, [d for d, _ in unreadable]


def load_impact(catalogue: Path, first_day: str, last_day: str):
    """Recorded events joined to one admin-1 unit each, inside the archive span.

    Only the scoring source is read; see IMPACT_SOURCE for why EM-DAT is not it.
    A DesInventar record names one unit, so the event-to-unit relation is the
    honest one-to-one the verdict needs.
    """
    con = sqlite3.connect(f"file:{catalogue}?immutable=1", uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT e.event_id, e.source_id, e.source_key, e.iso3, er.gid, e.start_date,"
        "       e.end_date, e.deaths, e.affected "
        "FROM event e JOIN event_region er ON er.event_id = e.event_id "
        "WHERE e.source_id = ? AND e.end_date >= ? AND e.start_date <= ? "
        "ORDER BY e.start_date",
        (IMPACT_SOURCE, first_day, last_day)).fetchall()

    # The same flood is filed more than once in places — identical unit and span
    # under different keys. Counting those twice would inflate whichever verdict
    # they land in, and with an assessable population this small that is the
    # difference between one case and three.
    seen, events = set(), []
    for r in rows:
        key = (r["gid"], r["start_date"], r["end_date"])
        if key in seen:
            continue
        seen.add(key)
        events.append(dict(r))

    countries = {r["iso3"]: dict(r) for r in con.execute(
        "SELECT iso3, name, desinventar, supported FROM country")}
    con.close()
    return events, countries


def span_days(start: str, end: str) -> int:
    return (date.fromisoformat(end) - date.fromisoformat(start)).days + 1


def widened(start: str, end: str) -> list[str]:
    """The event span with the reporting-lag tolerance added at both ends."""
    a = date.fromisoformat(start) - timedelta(days=JOIN_TOLERANCE_DAYS)
    b = date.fromisoformat(end) + timedelta(days=JOIN_TOLERANCE_DAYS)
    return [iso(a + timedelta(days=i)) for i in range((b - a).days + 1)]


def tier_events(events, obs, peaks, index, sig, rps, scorable_iso, archive):
    """Tier every event by whether MUST can be scored against it, and score those that can.

    Every event carries the observed peak, not only the ones that cleared the
    bar. The outside_rainfall_model tier is the build's main finding, and it is
    only believable if the rainfall it is asserting was ordinary can be read off
    the row: a flood that displaced three hundred thousand people under 12 mm of
    rain makes the case that a blank field cannot.
    """
    tiered, cases = [], []
    for e in events:
        gid, days = e["gid"], widened(e["start_date"], e["end_date"])
        span = span_days(e["start_date"], e["end_date"])
        hits = [obs[(d, gid)] for d in days if (d, gid) in obs]
        seen = [float(peaks[d][index[gid]]) for d in days if d in peaks]
        obs_mm = round(max(seen), 1) if seen else None
        obs_rp = max((h["rp_cleared"] for h in hits), default=None)

        if e["iso3"] not in scorable_iso:
            tier = "no_impact_source"
        elif span > MAX_SCORED_SPAN_DAYS:
            tier = "span_too_long"
        elif not any(d in archive for d in days):
            tier = "no_forecast"
        elif hits:
            tier = "assessable"
        else:
            tier = "outside_rainfall_model"

        tiered.append({**e, "span_days": span, "obs_mm": obs_mm, "obs_rp": obs_rp,
                       "tier": tier})
        if tier != "assessable":
            continue

        for rp in rps:
            leads = defaultdict(float)
            for d in days:
                for k, p in sig.get((d, gid, rp), {}).items():
                    leads[k] = max(leads[k], p)
            early = {k: p for k, p in leads.items() if k >= 1 and p >= STRONG_P}
            p0 = leads.get(0, 0.0)
            if early:
                best = max(early, key=lambda k: (early[k], k))
                verdict, p_best, lead_h = "missed_opportunity", early[best], best * 24
            elif p0 >= STRONG_P:
                verdict, p_best, lead_h = "late_warning", p0, 0
            else:
                verdict, p_best, lead_h = "forecast_miss", max(leads.values(), default=0.0), None
            cases.append({"event_id": e["event_id"], "gid": gid, "rp": rp,
                          "p_best": round(p_best, 4), "p_lead0": round(p0, 4),
                          "best_lead_h": lead_h, "verdict": verdict})
    return tiered, cases


def signal_rows(sig, computed):
    """Signal rows with a real zero told apart from an absent run.

    A lead that was computed and found nothing is 0.0; a lead whose run is
    missing or unreadable is NULL. Collapsing the two would let a hole in the
    archive read as a quiet forecast, which on the miss side of the contingency
    table is exactly the error that flatters the model.
    """
    for (day, gid, rp), leads in sig.items():
        yield (day, gid, rp, *(leads.get(k, 0.0) if (day, k) in computed else None
                               for k in LEAD_DAYS))


def write_db(path: Path, meta_rows, regions, coverage, obs, sig, computed, events, cases):
    if path.exists():
        path.unlink()
    con = sqlite3.connect(path)
    con.executescript((HERE / "schema.sql").read_text())
    con.executemany("INSERT INTO meta VALUES (?,?)", meta_rows)
    con.executemany("INSERT INTO region VALUES (?,?,?)",
                    [(m["gid"], m["iso3"], m["name"]) for m in regions])
    con.executemany("INSERT INTO coverage VALUES (?,?,?,?,?,?,?,?)", coverage)
    con.executemany("INSERT INTO obs_extreme VALUES (?,?,?,?)",
                    [(d, g, v["obs_mm"], v["rp_cleared"]) for (d, g), v in obs.items()])
    con.executemany("INSERT INTO signal VALUES (?,?,?,?,?,?)", signal_rows(sig, computed))
    con.executemany(
        "INSERT INTO impact_event VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [(e["event_id"], e["source_id"], e["source_key"], e["iso3"], e["gid"],
          e["start_date"], e["end_date"], e["span_days"], e["deaths"], e["affected"],
          e["obs_mm"], e["obs_rp"], e["tier"]) for e in events])
    # warning_record is written, not defaulted: it is a finding about the data
    # (no warning registry exists to check against), and a finding should be in
    # the rows rather than in a column default a reader has to go looking for.
    con.executemany(
        "INSERT INTO moi_case VALUES (?,?,?,?,?,?,?,?)",
        [(c["event_id"], c["gid"], c["rp"], c["p_best"], c["p_lead0"],
          c["best_lead_h"], c["verdict"], "none_available") for c in cases])
    con.commit()
    con.close()


def print_summary(obs, sig, events, cases, rps):
    """The two tables that decide whether any of this can be published."""
    print("\nanticipation over observed rainfall extremes "
          f"(obs bar {OBS_RP}-yr, lead >= 24 h, n={len(obs)})")
    print(f"  {'fc rp':>6} {'hits':>6} {'misses':>7} {'false alarms':>13} "
          f"{'hit rate':>9} {'FAR':>7}")
    for rp in rps:
        hit = miss = fa = 0
        strong = {(d, g) for (d, g, r), leads in sig.items() if r == rp
                  and max((p for k, p in leads.items() if k >= 1), default=0.0) >= STRONG_P}
        for key in obs:
            (hit, miss) = (hit + 1, miss) if key in strong else (hit, miss + 1)
        fa = len(strong - set(obs))
        hr = 100 * hit / (hit + miss) if hit + miss else 0.0
        far = 100 * fa / (hit + fa) if hit + fa else 0.0
        print(f"  {rp:>4}yr {hit:>6} {miss:>7} {fa:>13} {hr:>8.1f}% {far:>6.1f}%")
    print("  FAR is inflated by a scale mismatch: the forecast side maxes over "
          "51 members\n  and every cell in a unit, the observation side is one "
          "field regridded 0.1->0.4 deg.")

    tiers: dict[str, int] = defaultdict(int)
    for e in events:
        tiers[e["tier"]] += 1
    total = sum(tiers.values())
    print(f"\nrecorded events, tiered (source {IMPACT_SOURCE}, span <= "
          f"{MAX_SCORED_SPAN_DAYS} d, join +/-{JOIN_TOLERANCE_DAYS} d, n={total})")
    for t in ("assessable", "outside_rainfall_model", "no_impact_source",
              "span_too_long", "no_forecast"):
        n = tiers.get(t, 0)
        print(f"  {t:24s} {n:>4}  {100 * n / total if total else 0:>5.1f}%")

    n_cases = len({(c["event_id"], c["gid"]) for c in cases})
    print(f"\nmissed-opportunity cases (assessable only, n={n_cases})")
    for rp in rps:
        c = defaultdict(int)
        for x in cases:
            if x["rp"] == rp:
                c[x["verdict"]] += 1
        print(f"  {rp:>4}yr  missed_opportunity={c['missed_opportunity']:>3}  "
              f"late_warning={c['late_warning']:>3}  forecast_miss={c['forecast_miss']:>3}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=BACKEND / "data" / "moi.sqlite")
    ap.add_argument("--fields", type=Path, default=BACKEND / "cache" / "fields")
    ap.add_argument("--thresholds", type=Path,
                    default=BACKEND / "data" / "cmorph_ea_return_periods.nc")
    ap.add_argument("--imerg", type=Path, default=BACKEND / "data" / "gpm_imerg_ea_daily.nc")
    ap.add_argument("--catalogue", type=Path, default=BACKEND / "data" / "catalogue.sqlite")
    ap.add_argument("--adm1", type=Path, default=BACKEND / "data" / "ea-adm1-geo.json")
    ap.add_argument("--store", type=Path, required=True,
                    help="Icechunk store path, read only for its lat/lon/member axes")
    ap.add_argument("--summary", action="store_true", help="print the contingency tables")
    args = ap.parse_args()

    for name, p in (("fields cache", args.fields), ("thresholds", args.thresholds),
                    ("imerg", args.imerg), ("catalogue", args.catalogue),
                    ("adm1", args.adm1), ("store", args.store)):
        if not p.exists():
            sys.exit(f"{name} missing at {p}")

    lat, lon, members = load_grid(args.store)
    print(f"grid {lat.size}x{lon.size} at {abs(lat[1] - lat[0]):.2f} deg, {members} members")

    cells, meta = region_masks(args.adm1, lat, lon)
    thr = load_thresholds(args.thresholds, lat, lon)
    rps = sorted(thr)
    imerg = load_imerg(args.imerg, lat, lon)
    print(f"regions {len(meta)}  return periods {rps}  imerg days {len(imerg)}")

    archive = {f.stem for f in args.fields.glob("*.npz")}
    if not archive:
        sys.exit(f"no field files in {args.fields}; nothing to build a signal from")
    first_day, last_day = min(archive), iso(date.fromisoformat(max(archive))
                                           + timedelta(days=max(LEAD_DAYS)))

    valid_days = {iso(date.fromisoformat(d) + timedelta(days=k))
                  for d in archive for k in LEAD_DAYS}
    obs, peaks = build_observations(imerg, thr, cells, meta, valid_days)
    print(f"observed extremes (>= {OBS_RP}-yr) {len(obs)} region-days")

    sig, computed, unreadable = build_signal(args.fields, thr, cells, meta, members)

    # Below one member there is nothing to say, and keeping those rows would put
    # a row in the table for every unit on every day. Rounded to the same 4 dp
    # the stored values carry, or 1/51 would sit a hair above its own members
    # and drop every single-member row.
    floor = round(SIGNAL_FLOOR_MEMBERS / members, 4)
    sig = {k: v for k, v in sig.items() if max(v.values(), default=0.0) >= floor}

    # But an observed extreme the ensemble said nothing about is a miss, and the
    # miss is the finding. Those rows are forced back in so v_anticipation reads
    # them as a quiet forecast rather than losing them to an absent join.
    for (day, gid) in obs:
        for rp in rps:
            sig.setdefault((day, gid, rp), {})
    print(f"signal rows {len(sig)}")

    events, countries = load_impact(args.catalogue, first_day, last_day)

    # A country is scorable only where its loss database actually reaches into
    # the forecast archive. Djibouti's DesInventar ends in 2011 and Uganda's in
    # 2021; a silent unit there is an absent record, not a flood that did not
    # happen, and must never be counted as a warning that worked.
    by_iso: dict[str, list] = defaultdict(list)
    for e in events:
        by_iso[e["iso3"]].append(e)
    coverage = []
    for iso3, c in sorted(countries.items()):
        got = by_iso.get(iso3, [])
        coverage.append((
            iso3, c["name"], IMPACT_SOURCE if got else None,
            min((e["start_date"] for e in got), default=None),
            max((e["end_date"] for e in got), default=None),
            len(got), 1 if got else 0,
            None if got else "no admin-1 loss record inside the forecast archive",
        ))
    scorable_iso = {row[0] for row in coverage if row[6]}
    print(f"impact events {len(events)} in {len(scorable_iso)} scorable countries "
          f"({', '.join(sorted(scorable_iso))})")

    index = {m["gid"]: i for i, m in enumerate(meta)}
    tiered, cases = tier_events(events, obs, peaks, index, sig, rps, scorable_iso, archive)

    meta_rows = [
        ("schema_version", SCHEMA_VERSION),
        ("built_at", datetime.now(timezone.utc).isoformat(timespec="seconds")),
        ("archive_first_day", min(archive)),
        ("archive_last_day", max(archive)),
        ("members", str(members)),
        ("grid", f"{lat.size}x{lon.size} at {abs(lat[1] - lat[0]):.2f} deg"),
        ("strong_p", str(STRONG_P)),
        ("obs_rp", str(OBS_RP)),
        ("lead_days", ",".join(str(k) for k in LEAD_DAYS)),
        ("join_tolerance_days", str(JOIN_TOLERANCE_DAYS)),
        ("max_scored_span_days", str(MAX_SCORED_SPAN_DAYS)),
        ("impact_source", IMPACT_SOURCE),
        ("return_periods", ",".join(str(r) for r in rps)),
        ("obs_extremes", str(len(obs))),
        ("impact_events", str(len(tiered))),
        ("assessable_events", str(sum(1 for e in tiered if e["tier"] == "assessable"))),
        ("outside_rainfall_model",
         str(sum(1 for e in tiered if e["tier"] == "outside_rainfall_model"))),
        ("unreadable_field_files", ",".join(unreadable)),
        ("scorable_countries", ",".join(sorted(scorable_iso))),
        ("warning_registry", "none: the documented-warning clause is unverified"),
    ]
    write_db(args.out, meta_rows, meta, coverage, obs, sig, computed, tiered, cases)

    print(f"\nmoi: {args.out}")
    print(f"  obs_extreme   {len(obs)} region-days at or above the {OBS_RP}-yr level")
    print(f"  signal        {len(sig)} (day, unit, rp) rows over leads {LEAD_DAYS}")
    print(f"  impact_event  {len(tiered)} records, "
          f"{sum(1 for e in tiered if e['tier'] == 'assessable')} assessable")
    print(f"  moi_case      {len({(c['event_id'], c['gid']) for c in cases})} scored events")
    if args.summary:
        print_summary(obs, sig, tiered, cases, rps)
    return 0


if __name__ == "__main__":
    sys.exit(main())
