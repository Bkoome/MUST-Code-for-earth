"""EM-DAT flood-event matching for the calendar and regions feeds.

Loads the parsed EA flood export once at startup and answers, per forecast
init_date, whether a recorded flood overlaps it plus the impact metadata the
storymap surfaces. Empty file -> matching disabled, feeds fall back to null.
"""

import json
import logging
from datetime import date as _date
from pathlib import Path

from . import config

log = logging.getLogger(__name__)

_events: list[dict] = []  # flood events with parsed _start/_end date bounds, ascending


def _parse(value) -> _date | None:
    """YYYY-MM-DD (or longer ISO) string to a date, else None."""
    if not value:
        return None
    try:
        return _date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def init() -> None:
    """Load the parsed EM-DAT flood export; disable matching when absent."""
    global _events
    try:
        payload = json.loads(Path(config.EMDAT_FLOODS).read_text())
    except FileNotFoundError:
        log.warning("emdat floods missing at %s: matching disabled", config.EMDAT_FLOODS)
        return
    except Exception:
        log.exception("emdat floods unreadable: matching disabled")
        return

    events = []
    for e in payload.get("events", []):
        start = _parse(e.get("start"))
        if start is None:  # an undated event can't be matched to a forecast day
            continue
        events.append({**e, "_start": start, "_end": _parse(e.get("end")) or start})
    _events = sorted(events, key=lambda e: e["_start"])
    log.info("emdat floods loaded: %d events", len(_events))


def available() -> bool:
    return bool(_events)


def _region_count(event: dict) -> int | None:
    """Distinct admin-1 locations named in the event, or None when unlisted."""
    location = event.get("location")
    if not location:
        return None
    return len({part.strip() for part in str(location).split(",") if part.strip()}) or None


def _norm(name: str) -> str:
    """Lowercase and strip non-letters so 'Murang'a' matches 'Muranga'."""
    return "".join(c for c in name.lower() if c.isalpha())


# EM-DAT macro-region and English aliases -> GADM admin-1 names, keyed by (iso, _norm(alias)).
_ALIASES: dict[tuple[str, str], list[str]] = {
    ("SOM", "somaliland"): ["Awdal", "Woqooyi Galbeed", "Togdheer", "Sanaag", "Sool"],
    ("SOM", "puntland"): ["Bari", "Nugaal", "Mudug"],
    ("SOM", "jubaland"): ["Gedo", "Jubbada Dhexe", "Jubbada Hoose"],
    ("SOM", "hirshabelle"): ["Hiiraan", "Shabeellaha Dhexe"],
    ("SOM", "southweststates"): ["Bakool", "Bay", "Shabeellaha Hoose"],
    ("SOM", "southweststate"): ["Bakool", "Bay", "Shabeellaha Hoose"],
    ("SOM", "hiraan"): ["Hiiraan"],
    ("SOM", "lowerjuba"): ["Jubbada Hoose"],
    ("SOM", "middlejuba"): ["Jubbada Dhexe"],
    ("SOM", "lowershabelle"): ["Shabeellaha Hoose"],
    ("SOM", "middleshabelle"): ["Shabeellaha Dhexe"],
    ("SOM", "banadir"): ["Banaadir"],
    ("SOM", "mogadishu"): ["Banaadir"],
    ("TZA", "coast"): ["Pwani"],
    # Uganda macro regions expanded to the 2001-era GADM district list.
    ("UGA", "central"): [
        "Kalangala", "Kampala", "Kayunga", "Kiboga", "Luwero", "Masaka", "Mpigi",
        "Mubende", "Mukono", "Nakasongola", "Rakai", "Sembabule", "Wakiso",
    ],
    ("UGA", "eastern"): [
        "Bugiri", "Busia", "Iganga", "Jinja", "Kaberamaido", "Kamuli", "Kapchorwa",
        "Katakwi", "Kumi", "Mayuge", "Mbale", "Pallisa", "Sironko", "Soroti", "Tororo",
    ],
    ("UGA", "northern"): [
        "Adjumani", "Apac", "Arua", "Gulu", "Kitgum", "Kotido", "Lira", "Moroto",
        "Moyo", "Nakapiripirit", "Nebbi", "Pader", "Yumbe",
    ],
    ("UGA", "western"): [
        "Bundibugyo", "Bushenyi", "Hoima", "Kabale", "Kabarole", "Kamwenge", "Kanungu",
        "Kasese", "Kibale", "Kisoro", "Kyenjojo", "Masindi", "Mbarara", "Ntungamo", "Rukungiri",
    ],
}


def _location_names(event: dict) -> list[str]:
    """Location text as normalized name tokens, minus list glue like 'and'/'regions'."""
    location = str(event.get("location") or "")
    names = []
    for part in location.replace(";", ",").split(","):
        part = part.strip()
        for noise in ("and ", "the "):
            if part.lower().startswith(noise):
                part = part[len(noise):]
        for noise in (" regions", " region", " provinces", " province", " counties", " county", " districts", " district"):
            if part.lower().endswith(noise):
                part = part[: -len(noise)]
        if part:
            names.append(_norm(part))
    return names


def _gids(event: dict) -> list[str]:
    """Admin-1 gids for the event's named locations, matched within its country."""
    from . import regions

    iso = str(event.get("iso") or "")
    wanted = set(_location_names(event))
    # Expand macro-region aliases (e.g. 'Western Region', 'Somaliland') to GADM names.
    for token in list(wanted):
        for alias_name in _ALIASES.get((iso, token), []):
            wanted.add(_norm(alias_name))
    if not wanted or not regions.available():
        return []
    return [
        m["gid"]
        for m in regions.meta()
        if m["gid"].startswith(iso) and _norm(m["name"]) in wanted
    ]


def match(date: str) -> dict | None:
    """All recorded floods overlapping a forecast day, deadliest first."""
    day = _parse(date)
    if day is None:
        return None
    active = [e for e in _events if e["_start"] <= day <= e["_end"]]
    if not active:
        return None
    active.sort(key=lambda e: (e.get("total_deaths") or 0, e.get("total_affected") or 0), reverse=True)

    events = []
    all_gids: list[str] = []
    for e in active:
        gids = _gids(e)
        events.append({
            "event_key": e.get("disno"),
            "iso": e.get("iso"),
            "country": e.get("country"),
            "deaths": e.get("total_deaths"),
            "affected": e.get("total_affected"),
            "gids": gids,
            "start": e.get("start"),
            "end": e.get("end"),
        })
        all_gids.extend(g for g in gids if g not in all_gids)

    primary = active[0]
    lead_days = (primary["_start"] - day).days  # positive only when the run precedes onset
    primary_gids = events[0]["gids"]
    return {
        # Back-compat fields describe the deadliest (primary) event.
        "event_key": primary.get("disno"),
        "affected": primary.get("total_affected"),
        "regions": len(primary_gids) if primary_gids else _region_count(primary),
        "gids": primary_gids,
        "lead_h": lead_days * 24 if lead_days > 0 else None,
        # The full regional picture across every overlapping event.
        "events": events,
        "all_gids": all_gids,
        "total_affected": sum(e["affected"] or 0 for e in events) or None,
        "countries": len({e["iso"] for e in events if e["iso"]}),
    }


def matched(date: str) -> bool:
    """Whether any recorded flood overlaps the init_date (calendar marker)."""
    return match(date) is not None
