"""Missed-opportunity evaluation: what the ensemble anticipated, and what it could not.

Reads the moi_* tables of the shared artifact opened by app/db.py, written by
tools/moi/build_moi.py. Absent tables -> the feature is simply off, matching how
the catalogue, thresholds and IMERG already degrade.

Three populations, kept apart, because collapsing them is how a rainfall
forecast archive gets misread as a flood-warning scorecard:
  anticipation   the large-n verification, which needs no disaster record
  attribution    how much of the recorded burden is inside the hazard at all
  cases          the few events where both hold, and the only place the phrase means anything
"""

import logging
import sqlite3
from datetime import date as date_cls, timedelta

from . import config, db

log = logging.getLogger(__name__)

_con: sqlite3.Connection | None = None
_meta: dict[str, str] = {}

# Verdicts, worst-known first: also the ranking a day's cell takes when its units disagree.
# no_impact_data trails deliberately -- an uncovered unit cannot be scored, and must never
# be allowed to read as a warning that worked.
VERDICTS = (
    "missed_opportunity",       # a qualifying signal existed at an actionable lead
    "late_warning",             # the signal only appeared on the day itself
    "forecast_miss",            # assessable impact, no qualifying signal at any lead
    "outside_rainfall_model",   # impact recorded, no observed rainfall extreme
    "no_recorded_impact",       # observed extreme inside a covered country, nothing recorded
    "no_impact_data",           # observed extreme where no loss record reaches
)
_RANK = {v: i for i, v in enumerate(VERDICTS)}

# Verdicts a scored case can carry, in the order the sensitivity table reads.
CASE_VERDICTS = VERDICTS[:3]


def init() -> None:
    """Bind to the shared connection; missing moi_* tables disable the evaluation feed."""
    global _con, _meta
    if not db.has_table("moi_meta"):
        log.warning("moi tables absent in %s: evaluation feed disabled", config.CATALOGUE_DB)
        return
    con = db.connection()
    _con = con
    _meta = {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM moi_meta")}
    log.info("moi loaded: %s observed extremes, %s events, %s assessable, schema v%s",
             _meta.get("obs_extremes"), _meta.get("impact_events"),
             _meta.get("assessable_events"), _meta.get("schema_version"))


def available() -> bool:
    return _con is not None


def meta() -> dict:
    """Every parameter the verdicts depend on, returned whole: unseen thresholds cannot be judged."""
    return dict(_meta) if _con is not None else {}


def _strong_p() -> float:
    return float(_meta.get("strong_p", 0.15))


def _year_span(year: int | None) -> tuple[str, str] | None:
    return (f"{year}-01-01", f"{year}-12-31") if year else None


def coverage() -> list[dict]:
    """Where an admin-1 loss record actually exists inside the forecast archive."""
    if _con is None:
        return []
    return [dict(r) for r in _con.execute(
        "SELECT m.iso3, c.name, m.source_id, m.first_day, m.last_day, m.events, m.scorable, m.note "
        "FROM moi_coverage m JOIN country c ON c.iso3 = m.iso3 "
        "ORDER BY m.scorable DESC, m.iso3")]


def _covered_spans() -> list[tuple[str, str, str]]:
    """Scorable countries as (iso3, first_day, last_day) -- eleven rows, walked in Python."""
    if _con is None:
        return []
    return [(r["iso3"], r["first_day"], r["last_day"]) for r in _con.execute(
        "SELECT iso3, first_day, last_day FROM moi_coverage WHERE scorable = 1")]


def _covered_on(spans, iso3: str, date: str) -> bool:
    """Scorability is per day, not per country: Kenya's record stops in July 2025."""
    return any(i == iso3 and f <= date <= l for i, f, l in spans)


def anticipation(rp: int | None = None, year: int | None = None) -> dict:
    """The 2x2 over observed rainfall extremes at >= 24 h of lead, for every return period.

    A hit is an observed extreme already flagged by a run issued at least a day ahead; a
    false alarm is such a flag with no observed extreme under it. Every rp is returned, not
    only the one asked for: the counts move sharply with rp, and a reader shown one column
    would draw a conclusion from whichever pill they happened to land on.

    NULL leads are absent runs and count as no signal here -- the pessimistic reading on
    the hit side, and the same one the builder printed its summary under.
    """
    if _con is None:
        return {}
    span = _year_span(year)
    obs_where = " AND valid_date BETWEEN ? AND ?" if span else ""
    sig_where = " AND s.valid_date BETWEEN ? AND ?" if span else ""
    args = list(span) if span else []

    population = _con.execute(
        f"SELECT COUNT(*) FROM moi_obs_extreme WHERE 1 = 1{obs_where}", args).fetchone()[0]
    rows = _con.execute(
        "SELECT s.rp, "
        "       SUM(CASE WHEN o.gid IS NOT NULL THEN 1 ELSE 0 END) AS hits, "
        "       SUM(CASE WHEN o.gid IS NULL THEN 1 ELSE 0 END) AS false_alarms "
        "FROM moi_signal s "
        "LEFT JOIN moi_obs_extreme o ON o.valid_date = s.valid_date AND o.gid = s.gid "
        "WHERE MAX(COALESCE(s.p_lead1, 0), COALESCE(s.p_lead2, 0)) >= ?"
        f"{sig_where} GROUP BY s.rp ORDER BY s.rp",
        [_strong_p()] + args).fetchall()

    by_rp = [{
        "rp": r["rp"],
        "hits": r["hits"],
        "misses": population - r["hits"],
        "false_alarms": r["false_alarms"],
        # Both rates or neither: a hit rate alone flatters the model, a FAR alone condemns it.
        "hit_rate": r["hits"] / population if population else None,
        "far": r["false_alarms"] / (r["hits"] + r["false_alarms"])
        if r["hits"] + r["false_alarms"] else None,
    } for r in rows]

    return {
        "population": population,
        "lead_hours": 24,
        "obs_rp": int(_meta.get("obs_rp", 2)),
        "strong_p": _strong_p(),
        "rp": rp,
        "at_rp": next((b for b in by_rp if b["rp"] == rp), None),
        "by_rp": by_rp,
    }


def attribution() -> dict:
    """How much of the recorded flood burden is inside MUST's hazard at all.

    The contrast in observed peak carries the finding: records outside the rainfall model
    are not near-misses of it, their units saw ordinary rain. Broken out by tier so that
    season-scale records -- excluded for an unrelated reason -- are not folded into it.
    """
    if _con is None:
        return {}
    tiers = [dict(r) for r in _con.execute(
        "SELECT tier, COUNT(*) AS events, AVG(obs_mm) AS mean_obs_mm, "
        "       SUM(COALESCE(e.deaths, 0)) AS deaths, SUM(COALESCE(e.affected, 0)) AS affected "
        "FROM moi_impact m JOIN event e ON e.event_id = m.event_id "
        "GROUP BY tier ORDER BY events DESC")]
    return {
        "events": sum(t["events"] for t in tiers),
        "tiers": tiers,
        "impact_source": _meta.get("impact_source"),
        "join_tolerance_days": int(_meta.get("join_tolerance_days", 1)),
        "max_scored_span_days": int(_meta.get("max_scored_span_days", 7)),
    }


def cases(rp: int) -> list[dict]:
    """The assessable events as a named ledger, scored at this return period.

    Five events cannot carry a rate, so they are returned whole -- lead, observed peak and
    losses attached -- to be weighed one by one. warning_record travels with every row
    precisely because it is always 'none_available': the documented-warning clause is
    unverified, and burying that in prose would let the ledger read as more than it is.
    """
    if _con is None:
        return []
    return [dict(r) for r in _con.execute(
        "SELECT c.event_id, c.gid, r.name AS region, r.iso3, c.rp, c.verdict, "
        "       c.p_best, c.p_lead0, c.best_lead_h, c.warning_record, "
        "       m.span_days, m.obs_mm, m.obs_rp, "
        "       e.source_id AS source, e.source_key AS event_key, e.source_place AS place, "
        "       e.start_date AS start, e.end_date AS end, e.deaths, e.affected "
        "FROM moi_case c "
        "JOIN moi_impact m ON m.event_id = c.event_id AND m.gid = c.gid "
        "JOIN event e ON e.event_id = c.event_id "
        "JOIN region r ON r.gid = c.gid "
        "WHERE c.rp = ? "
        "ORDER BY COALESCE(e.deaths, 0) DESC, COALESCE(e.affected, 0) DESC, e.start_date",
        (rp,))]


def case_counts() -> list[dict]:
    """Verdict counts per return period: the sensitivity, in the open.

    The count swings from two missed opportunities at the 2-yr bar to none at 20-yr and
    above, which is the only honest way to present a five-event population.
    """
    if _con is None:
        return []
    counts: dict[int, dict] = {}
    for r in _con.execute(
            "SELECT rp, verdict, COUNT(*) AS n FROM moi_case GROUP BY rp, verdict"):
        counts.setdefault(r["rp"], {})[r["verdict"]] = r["n"]
    return [{"rp": rp, **{v: row.get(v, 0) for v in CASE_VERDICTS}}
            for rp, row in sorted(counts.items())]


def days(rp: int, year: int | None = None) -> dict[str, dict]:
    """Per-day verdict for the calendar's verdict fill, worst unit deciding the cell.

    Three small queries and one pass rather than a round trip per day: the calendar asks
    for a whole year at once and needs every cell coloured before the first paint.
    """
    if _con is None:
        return {}
    span = _year_span(year)
    spans = _covered_spans()
    out: dict[str, dict] = {}

    def record(date: str, verdict: str) -> None:
        cell = out.setdefault(date, {"verdict": verdict, "units": 0, "counts": {}})
        cell["counts"][verdict] = cell["counts"].get(verdict, 0) + 1
        cell["units"] += 1
        if _RANK[verdict] < _RANK[cell["verdict"]]:
            cell["verdict"] = verdict

    obs_where = " AND o.valid_date BETWEEN ? AND ?" if span else ""
    for r in _con.execute(
            "SELECT o.valid_date, r.iso3 FROM moi_obs_extreme o JOIN region r ON r.gid = o.gid "
            f"WHERE 1 = 1{obs_where}", list(span) if span else []):
        covered = _covered_on(spans, r["iso3"], r["valid_date"])
        record(r["valid_date"], "no_recorded_impact" if covered else "no_impact_data")

    # A recorded event is the stronger statement about a day, so its verdict outranks the
    # observation-only reading on every day it covers.
    ev_where = " AND e.start_date <= ? AND e.end_date >= ?" if span else ""
    for e in _con.execute(
            "SELECT e.start_date, e.end_date, m.tier, c.verdict "
            "FROM moi_impact m JOIN event e ON e.event_id = m.event_id "
            "LEFT JOIN moi_case c ON c.event_id = m.event_id AND c.gid = m.gid AND c.rp = ? "
            f"WHERE 1 = 1{ev_where}",
            [rp] + ([span[1], span[0]] if span else [])):
        verdict = e["verdict"] or (
            "outside_rainfall_model" if e["tier"] == "outside_rainfall_model" else None)
        if verdict is None:
            continue  # span_too_long and no_forecast carry no verdict to paint
        for date in _span_dates(e["start_date"], e["end_date"], span):
            record(date, verdict)
    return out


def _span_dates(start: str, end: str, clip: tuple[str, str] | None) -> list[str]:
    """Every day an event covers, clipped to the requested year."""
    lo, hi = (max(start, clip[0]), min(end, clip[1])) if clip else (start, end)
    if lo > hi:
        return []
    day, stop = date_cls.fromisoformat(lo), date_cls.fromisoformat(hi)
    out = []
    while day <= stop:
        out.append(day.isoformat())
        day += timedelta(days=1)
    return out


def day(date: str, rp: int) -> list[dict]:
    """Per-admin-1 verdicts for one day, for the map and the day card.

    Units carrying only a forecast signal are deliberately absent: the choropleth already
    paints forecast probability, and a unit where nothing was observed and nothing recorded
    has no outcome to render. False alarms are counted in anticipation(), where a rate belongs.
    """
    if _con is None:
        return []
    spans = _covered_spans()
    strong = _strong_p()
    units: dict[str, dict] = {}

    def unit(gid: str) -> dict:
        return units.setdefault(gid, {
            "gid": gid, "name": None, "iso3": None, "verdict": None,
            "obs_mm": None, "obs_rp": None, "anticipated": False,
            "p_best": None, "lead_h": None, "event": None,
        })

    for r in _con.execute(
            "SELECT o.gid, o.obs_mm, o.rp_cleared, r.name, r.iso3 "
            "FROM moi_obs_extreme o JOIN region r ON r.gid = o.gid WHERE o.valid_date = ?",
            (date,)):
        covered = _covered_on(spans, r["iso3"], date)
        unit(r["gid"]).update(
            name=r["name"], iso3=r["iso3"], obs_mm=r["obs_mm"], obs_rp=r["rp_cleared"],
            verdict="no_recorded_impact" if covered else "no_impact_data")

    for r in _con.execute(
            "SELECT gid, p_lead0, p_lead1, p_lead2 FROM moi_signal "
            "WHERE valid_date = ? AND rp = ?", (date, rp)):
        if r["gid"] not in units:
            continue
        lead1, lead2 = r["p_lead1"] or 0.0, r["p_lead2"] or 0.0
        u = units[r["gid"]]
        u["p_best"] = max(lead1, lead2, r["p_lead0"] or 0.0)
        if max(lead1, lead2) >= strong:
            u["anticipated"] = True
            u["lead_h"] = 48 if lead2 >= strong else 24

    for r in _con.execute(
            "SELECT m.event_id, m.gid, m.tier, m.span_days, m.obs_mm, "
            "       e.iso3, e.start_date, e.end_date, e.deaths, e.affected, "
            "       e.source_id, e.source_key, r.name, "
            "       c.verdict, c.p_best, c.best_lead_h, c.warning_record "
            "FROM moi_impact m JOIN event e ON e.event_id = m.event_id "
            "JOIN region r ON r.gid = m.gid "
            "LEFT JOIN moi_case c ON c.event_id = m.event_id AND c.gid = m.gid AND c.rp = ? "
            "WHERE e.start_date <= ? AND e.end_date >= ?", (rp, date, date)):
        u = unit(r["gid"])
        u["name"], u["iso3"] = r["name"], r["iso3"]
        u["event"] = {
            "event_id": r["event_id"], "source": r["source_id"], "event_key": r["source_key"],
            "start": r["start_date"], "end": r["end_date"], "span_days": r["span_days"],
            "deaths": r["deaths"], "affected": r["affected"], "obs_mm": r["obs_mm"],
            "tier": r["tier"], "warning_record": r["warning_record"],
        }
        # The case searched the event span widened by the reporting-lag tolerance, so it
        # is the authority on what was anticipated here -- the single-day signal read is not.
        if r["verdict"] and r["best_lead_h"] is not None:
            u["lead_h"], u["p_best"], u["anticipated"] = r["best_lead_h"], r["p_best"], True
        verdict = r["verdict"] or (
            "outside_rainfall_model" if r["tier"] == "outside_rainfall_model" else None)
        if verdict and (u["verdict"] is None or _RANK[verdict] < _RANK[u["verdict"]]):
            u["verdict"] = verdict

    return sorted((u for u in units.values() if u["verdict"]),
                  key=lambda u: (_RANK[u["verdict"]], -(u["obs_mm"] or 0.0)))
