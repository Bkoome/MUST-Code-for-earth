"""Multi-source disaster catalogue: recorded flood events joined to admin-1.

Reads data/catalogue.sqlite, built offline by tools/catalogue/build_catalogue.py
from EM-DAT, DesInventar and hand-maintained rows. Missing file -> the feature
is simply off, matching how thresholds, IMERG and EM-DAT already degrade.

The database is opened read-only and never written: it ships as a build artifact
mounted from /data, so a writable handle would only invite corruption of a file
the service does not own.
"""

import logging
import sqlite3
from pathlib import Path

from . import config

log = logging.getLogger(__name__)

_con: sqlite3.Connection | None = None
_meta: dict[str, str] = {}


def init() -> None:
    """Open the catalogue read-only; absent or unreadable file disables it."""
    global _con, _meta
    path = Path(config.CATALOGUE_DB)
    if not path.exists():
        log.warning("catalogue missing at %s: event feed disabled", path)
        return
    try:
        # immutable=1 promises the file will not change under us, which lets
        # SQLite skip locking entirely — correct for a read-only bind mount.
        con = sqlite3.connect(f"file:{path}?immutable=1", uri=True, check_same_thread=False)
        con.row_factory = sqlite3.Row
        meta = {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM meta")}
    except Exception:
        log.exception("catalogue unreadable at %s: event feed disabled", path)
        return
    _con, _meta = con, meta
    log.info("catalogue loaded: %s events, %s sources, schema v%s",
             meta.get("events"), len(sources()), meta.get("schema_version"))


def available() -> bool:
    return _con is not None


def meta() -> dict:
    """Build provenance, plus the two counts that describe crosswalk health."""
    if _con is None:
        return {}
    # Returned whole, deliberately: the build writes unplaced_events and
    # unmatched_places into meta, and an event attributed to no region is
    # invisible on the map, so those counts belong in the service metadata.
    return dict(_meta)


def sources() -> list[dict]:
    if _con is None:
        return []
    return [dict(r) for r in _con.execute(
        "SELECT source_id, title, publisher, url, licence, retrieved FROM source")]


def unsupported_countries() -> list[dict]:
    """Countries no automated source reaches, which a human maintains by hand."""
    if _con is None:
        return []
    return [dict(r) for r in _con.execute(
        "SELECT iso3, name, desinventar, maintainer_note FROM country WHERE supported = 0")]


# A record spanning longer than this is a country-season aggregate, not the day's
# event: EM-DAT will file one "flood" running fifteen months for a whole rainy
# season. Such a record covers almost any date you ask for, so on impact alone it
# would head the ledger on every day of the year and bury the events that
# actually happened then. They stay in the list — they are real records — but
# they sort below the ones whose span brackets the day.
AGGREGATE_SPAN_DAYS = 92


def events_on(date: str) -> list[dict]:
    """Recorded events whose span covers this day, most relevant to it first.

    Relevance before impact: records that bracket the day closely come first,
    worst impact leading within each group, and season-scale aggregates trail.

    One query, one pass: the regions come back as a joined list rather than a
    query per event, because the calendar asks this for every day it renders.
    """
    if _con is None:
        return []
    rows = _con.execute(
        "SELECT e.event_id, e.source_id, e.source_key, e.iso3, e.hazard, e.start_date,"
        "       e.end_date, e.deaths, e.affected, e.damage_usd, e.source_place,"
        "       er.gid, er.match_method, er.confidence, r.name AS region_name "
        "FROM event e "
        "LEFT JOIN event_region er ON er.event_id = e.event_id "
        "LEFT JOIN region r ON r.gid = er.gid "
        "WHERE e.start_date <= ? AND e.end_date >= ? "
        "ORDER BY (julianday(e.end_date) - julianday(e.start_date) >= ?) ASC, "
        "         COALESCE(e.deaths, 0) DESC, COALESCE(e.affected, 0) DESC",
        (date, date, AGGREGATE_SPAN_DAYS)).fetchall()

    events: dict[int, dict] = {}
    for r in rows:
        e = events.setdefault(r["event_id"], {
            "event_id": r["event_id"],
            "source": r["source_id"],
            "event_key": r["source_key"],
            "iso": r["iso3"],
            "hazard": r["hazard"],
            "start": r["start_date"],
            "end": r["end_date"],
            "deaths": r["deaths"],
            "affected": r["affected"],
            "damage_usd": r["damage_usd"],
            "place": r["source_place"],
            "regions": [],
        })
        if r["gid"]:
            e["regions"].append({
                "gid": r["gid"], "name": r["region_name"],
                "method": r["match_method"], "confidence": r["confidence"],
            })
    return list(events.values())


def matched(date: str) -> bool:
    """Whether any recorded event covers this day (calendar marker)."""
    if _con is None:
        return False
    row = _con.execute(
        "SELECT 1 FROM event WHERE start_date <= ? AND end_date >= ? LIMIT 1",
        (date, date)).fetchone()
    return row is not None


def gids_on(date: str) -> list[str]:
    """Distinct admin-1 gids touched by any event covering this day."""
    if _con is None:
        return []
    return [r["gid"] for r in _con.execute(
        "SELECT DISTINCT er.gid FROM event e JOIN event_region er ON er.event_id = e.event_id "
        "WHERE e.start_date <= ? AND e.end_date >= ? ORDER BY er.gid", (date, date))]
