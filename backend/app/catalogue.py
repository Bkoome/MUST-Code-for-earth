"""Recorded flood events joined to admin-1, from the artifact app/db.py opens.

Built offline by tools/catalogue/build_catalogue.py; absent tables turn the feed off.
"""

import logging
import sqlite3

from . import config, db

log = logging.getLogger(__name__)

_con: sqlite3.Connection | None = None
_meta: dict[str, str] = {}


def init() -> None:
    """Bind to the shared connection; missing catalogue tables disable the event feed."""
    global _con, _meta
    if not db.has_table("event"):
        log.warning("catalogue tables absent in %s: event feed disabled", config.CATALOGUE_DB)
        return
    con = db.connection()
    _con = con
    _meta = {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM meta")}
    log.info("catalogue loaded: %s events, %s sources, schema v%s",
             _meta.get("events"), len(sources()), _meta.get("schema_version"))


def available() -> bool:
    return _con is not None


def meta() -> dict:
    """Build provenance, returned whole: unplaced_events and unmatched_places are the
    crosswalk's own failure counts, and an event placed on no region is invisible."""
    return dict(_meta) if _con is not None else {}


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


# Longer than this is a country-season aggregate, not the day's event. EM-DAT files
# floods running fifteen months, which would head the ledger on every day of the year,
# so they stay in the list but sort below records whose span brackets the day.
AGGREGATE_SPAN_DAYS = 92


def events_on(date: str) -> list[dict]:
    """Recorded events covering this day: relevance before impact, aggregates trailing.

    One query, one pass — the calendar asks this for every day it renders.
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
