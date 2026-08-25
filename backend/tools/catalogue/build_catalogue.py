#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["openpyxl"]
# ///
"""Build data/catalogue.sqlite: flood events from every source, joined to admin-1.

    uv run build_catalogue.py                 # build from whatever sources are present
    uv run build_catalogue.py --review        # build, then print the review queue

Sources, in the order they are trusted:

  emdat        data/emdat_ea_floods.json, produced by tools/emdat/parse_emdat_export.py
  desinventar  tools/catalogue/sources/desinventar_<ISO3>.xml (UNDRR per-country export)
  manual       tools/catalogue/manual/events.csv, for countries no source covers

The geographic crosswalk is NOT inferred here. Exact name matches are accepted
automatically because they are checkable by inspection; everything else must
appear in tools/catalogue/crosswalk/<source>.csv with a reviewer and a reason,
or the place lands in crosswalk_unmatched for a human to resolve. A build that
silently guesses is worse than one that reports what it could not place, because
a wrong region attribution is invisible downstream.
"""

import argparse
import csv
import json
import re
import sqlite3
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).parent
BACKEND = HERE.parent.parent
SCHEMA_VERSION = "1"

# Hazard vocabularies differ per source; both collapse onto these.
HAZARD_FLOOD = "flood"
HAZARD_FLASH = "flash_flood"


def norm(name: str) -> str:
    """Lowercase, letters only, so "Murang'a" and "Muranga" are one key.

    Matches app/emdat.py's _norm exactly; the two must agree or the crosswalk
    built here would not reproduce the matching the service already does.
    """
    return "".join(c for c in str(name).lower() if c.isalpha())


# --------------------------------------------------------------------- inputs


def load_regions(path: Path) -> list[dict]:
    """The admin-1 universe, mirrored from the geojson the service rasterizes."""
    gj = json.loads(path.read_text())
    out = []
    for f in gj["features"]:
        p = f["properties"]
        out.append({
            "gid": p["gid"],
            "iso3": p["gid"].split(".")[0],
            "name": p["name"],
            "name_norm": norm(p["name"]),
        })
    return out


def _rows(path: Path):
    """CSV rows with '#' comment lines stripped, so the data files can explain
    themselves to the human who maintains them."""
    lines = [ln for ln in path.read_text().splitlines() if not ln.lstrip().startswith("#")]
    return list(csv.DictReader(lines))


def load_countries(path: Path) -> list[dict]:
    if not path.exists():
        sys.exit(f"countries.csv missing at {path}; it declares which countries are supported")
    rows = _rows(path)
    for r in rows:
        r["supported"] = int(r.get("supported", "1") or 1)
    return rows


def load_crosswalk(dirpath: Path, regions: list[dict]) -> tuple[dict, list[str]]:
    """Reviewed rows keyed by (iso3, source_id, name_norm) -> [gid, ...].

    Returns the mapping plus any integrity complaints, which abort the build:
    a crosswalk pointing at a gid that does not exist is a silent data loss.
    """
    valid = {r["gid"] for r in regions}
    table: dict[tuple[str, str, str], list[dict]] = {}
    problems = []
    for csv_path in sorted(dirpath.glob("*.csv")):
        for lineno, row in enumerate(_rows(csv_path), start=2):
            if not row.get("source_name"):
                continue
            iso3 = row["iso3"].strip().upper()
            source_id = row["source_id"].strip()
            gid = row["gid"].strip()
            status = row["status"].strip()
            where = f"{csv_path.name}:{lineno}"
            if status != "rejected" and gid not in valid:
                problems.append(f"{where}: gid {gid!r} is not an admin-1 unit")
                continue
            if status != "exact" and not row.get("note", "").strip():
                problems.append(f"{where}: status {status!r} requires a note explaining it")
            key = (iso3, source_id, norm(row["source_name"]))
            table.setdefault(key, []).append({
                "gid": gid,
                "status": status,
                "note": row.get("note", "").strip(),
                "source_name": row["source_name"].strip(),
                "reviewed_by": row.get("reviewed_by", "").strip(),
                "reviewed_on": row.get("reviewed_on", "").strip(),
            })
    return table, problems


# -------------------------------------------------------------------- readers


def _iso(value) -> str | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except ValueError:
        return None


# Trailing words that describe an admin level rather than name a place.
_LEVEL_WORDS = (" regions", " region", " provinces", " province", " counties",
                " county", " districts", " district", " states", " state",
                " zones", " zone", " governorates", " governorate")


def _strip_noise(part: str) -> str:
    """Reduce one fragment to a bare place name, or "" if nothing is left."""
    part = part.strip().strip("-–—").strip()
    low = part.lower()
    for noise in ("and ", "the ", "of "):
        if low.startswith(noise):
            part = part[len(noise):]
            low = part.lower()
    for noise in _LEVEL_WORDS:
        if low.endswith(noise):
            part = part[: -len(noise)]
            break
    return part.strip()


def _places_from_location(location: str) -> list[str]:
    """Split EM-DAT free-text location into candidate place tokens.

    EM-DAT's `location` is prose, not a list, and three habits of it defeat a
    plain comma split. It conjoins names ("Oromia and Afar Regions"), it nests
    the parent unit in brackets ("Baardheere District (Gedo Region)"), and it
    appends the admin level as a word. Every fragment is emitted as a candidate
    rather than one being chosen: an admin-2 name simply fails to match admin-1
    and lands in the review queue, whereas dropping the bracketed parent would
    lose the only part that *can* match.
    """
    candidates: list[str] = []
    for chunk in re.split(r"[;,/]", str(location or "")):
        for part in re.split(r"[()\[\]]", chunk):
            # "Jowhar in Hirshabelle" names the child then its parent, and the
            # parent is the half that can match an admin-1 unit.
            for piece in re.split(r"\b(?:and|in)\b", part, flags=re.IGNORECASE):
                name = _strip_noise(piece)
                if name:
                    candidates.append(name)
    return candidates


def read_emdat(path: Path) -> list[dict]:
    """EM-DAT flood events, with both the free text and the structured units."""
    if not path.exists():
        return []
    payload = json.loads(path.read_text())
    out = []
    for e in payload.get("events", []):
        start = _iso(e.get("start"))
        if not start:  # an undated event cannot be matched to a forecast day
            continue
        classif = str(e.get("classif_key") or "")
        places = _places_from_location(e.get("location") or "")
        # adminUnits is EM-DAT's own structured field and is far more reliable
        # than the prose, so its names are added as first-class place tokens.
        admin = e.get("admin_units")
        if isinstance(admin, list):
            places += [u.get("adm1_name") for u in admin if isinstance(u, dict) and u.get("adm1_name")]
        out.append({
            "source_id": "emdat",
            "source_key": e.get("disno"),
            "iso3": e.get("iso"),
            "hazard": HAZARD_FLASH if classif.endswith("fla") else HAZARD_FLOOD,
            "hazard_raw": classif or None,
            "start_date": start,
            "end_date": _iso(e.get("end")) or start,
            "deaths": e.get("total_deaths"),
            "affected": e.get("total_affected"),
            "damage_usd": (e["total_dam"] * 1000.0) if e.get("total_dam") else None,
            "source_place": e.get("location"),
            "source_admin": json.dumps(admin) if admin else None,
            "places": [p for p in places if p],
        })
    return out


# DesInventar's event vocabulary is English and uppercase, verified against the
# Kenya export (30 types, of which ROAD ACCIDENT and FIRE dominate). Only the
# water-driven ones enter a flood catalogue; RAINS is included because a heavy
# rainfall event is exactly what the exceedance index is built to detect.
# Each national database keeps its own language, so the vocabulary is matched
# per term rather than assumed English: Djibouti files floods as INONDATION, and
# an unmapped term is dropped silently, which cost 94 Djibouti records.
DESINVENTAR_WATER = {
    # English (Kenya, Somalia, Tanzania, Uganda)
    "FLOOD": HAZARD_FLOOD, "FLASH FLOOD": HAZARD_FLASH, "RAINS": "heavy_rain",
    # French (Djibouti)
    "INONDATION": HAZARD_FLOOD, "CRUE SOUDAINE": HAZARD_FLASH,
    "PLUIES EXTREME": "heavy_rain", "PLUIES EXTREMES": "heavy_rain",
}


def _di_records(path: Path):
    """Yield each <fichas> row of a DesInventar export as a tag->text dict.

    Streamed with iterparse and cleared as it goes: the Kenya export is 4.4 MB
    zipped and 118 MB of XML, and every national export is the same shape.
    Records are <TR> rows, not the <TarjetaFicha> the older documentation implies.
    """
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as zf:
            member = next((n for n in zf.namelist() if n.endswith(".xml")), None)
            if member is None:
                return
            with zf.open(member) as fh:
                yield from _di_rows(fh)
    else:
        with path.open("rb") as fh:
            yield from _di_rows(fh)


def _di_rows(fh):
    for _, el in ET.iterparse(fh, events=("end",)):
        if el.tag == "TR":
            row = {c.tag: (c.text or "").strip() for c in el}
            # Lookup tables share the <TR> element; only event cards carry a date.
            if "fechano" in row:
                yield row
            el.clear()


def read_desinventar(dirpath: Path) -> list[dict]:
    """Parse UNDRR DesInventar per-country exports (zip or bare XML).

    Geography comes from `name0`, the top admin level of each national database.
    For Kenya that is the 47 counties, which are exactly this app's admin-1 units
    — 45 of 47 match by name with no crosswalk at all. Other countries divide
    differently, so the level is not assumed to be admin-1 anywhere else: names
    that do not match simply land in the review queue.
    """
    out = []
    for src in sorted(list(dirpath.glob("*.zip")) + list(dirpath.glob("*.xml"))):
        stem = src.stem  # DI_export_ken / desinventar_KEN
        iso3 = stem.split("_")[-1].upper()
        if len(iso3) != 3:
            print(f"  ! {src.name}: cannot read an ISO3 from the filename; skipped", file=sys.stderr)
            continue
        n = 0
        # The Kenya export repeats two serials verbatim. De-duplicate on the
        # source's own key and say so, rather than letting the UNIQUE constraint
        # decide silently which copy survives.
        seen_keys: set[str] = set()
        duplicates = 0
        for row in _di_records(src):
            hazard = DESINVENTAR_WATER.get((row.get("evento") or "").upper())
            if hazard is None:
                continue
            y, m, d = row.get("fechano"), row.get("fechames"), row.get("fechadia")
            if not y:
                continue
            try:
                start = date(int(y), int(m or 1), int(d or 1))
            except ValueError:
                continue
            # There is no end-date field; `duracion` is the span in days.
            try:
                span = max(0, int(float(row.get("duracion") or 0)))
            except ValueError:
                span = 0
            end = start + timedelta(days=min(span, 366))

            def num(tag):
                raw = row.get(tag) or ""
                try:
                    return int(float(raw)) or None
                except ValueError:
                    return None

            # DesInventar serials restart per national database, so Kenya and
            # Somalia both carry serial 1000. Scope the key by country or the
            # second country loaded collides on (source_id, source_key).
            serial = row.get("serial")
            key = f"{iso3}-{serial}" if serial else f"{iso3}-{start.isoformat()}"
            if key in seen_keys:
                duplicates += 1
                continue
            seen_keys.add(key)
            places = [p for p in (row.get("name0"), row.get("name1")) if p]
            out.append({
                "source_id": "desinventar",
                "source_key": key,
                "iso3": iso3,
                "hazard": hazard,
                "hazard_raw": row.get("evento") or None,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "deaths": num("muertos"),
                "affected": num("afectados"),
                "damage_usd": float(row["valorus"]) if (row.get("valorus") or "").strip()
                              not in ("", "0") else None,
                "source_place": row.get("lugar") or row.get("name0") or None,
                "source_admin": json.dumps({k: row.get(k) for k in
                                            ("level0", "name0", "level1", "name1")}),
                "places": places,
            })
            n += 1
        note = f", {duplicates} duplicate serial(s) dropped" if duplicates else ""
        print(f"  desinventar {iso3}: {n} water-driven records from {src.name}{note}")
    return out


def read_manual(path: Path) -> list[dict]:
    """Hand-maintained events, for countries no automated source covers.

    This is the escape hatch that keeps unsupported countries first-class: the
    row format is the same as any other source, so a manually entered event is
    queryable, attributable and renderable exactly like an EM-DAT one.
    """
    if not path.exists():
        return []
    out = []
    for row in _rows(path):
        if not row.get("source_key"):
            continue
        start_date = _iso(row["start_date"])
        if not start_date:
            print(f"  ! manual event {row['source_key']}: bad start_date; skipped", file=sys.stderr)
            continue
        gids = [g.strip() for g in (row.get("gids") or "").split("|") if g.strip()]
        out.append({
            "source_id": "manual",
            "source_key": row["source_key"].strip(),
            "iso3": row["iso3"].strip().upper(),
            "hazard": (row.get("hazard") or HAZARD_FLOOD).strip(),
            "hazard_raw": None,
            "start_date": start_date,
            "end_date": _iso(row.get("end_date")) or start_date,
            "deaths": int(row["deaths"]) if row.get("deaths") else None,
            "affected": int(row["affected"]) if row.get("affected") else None,
            "damage_usd": float(row["damage_usd"]) if row.get("damage_usd") else None,
            "source_place": row.get("place") or None,
            "source_admin": None,
            # Manual rows name their regions outright: no crosswalk needed,
            # which is the point of the escape hatch.
            "explicit_gids": gids,
            "places": [],
        })
    return out


# ------------------------------------------------------------------- resolving


def resolve(events: list[dict], regions: list[dict], crosswalk: dict):
    """Attach admin-1 gids to each event; collect what could not be placed."""
    by_iso: dict[str, dict[str, str]] = {}
    for r in regions:
        by_iso.setdefault(r["iso3"], {})[r["name_norm"]] = r["gid"]

    unmatched: dict[tuple[str, str, str], dict] = {}
    for e in events:
        links: dict[str, tuple[str, float]] = {}
        for gid in e.get("explicit_gids", []):
            links[gid] = ("manual", 1.0)

        names = by_iso.get(e["iso3"], {})
        for place in e["places"]:
            key = norm(place)
            if not key:
                continue
            # 1. exact name match inside the event's own country
            gid = names.get(key)
            if gid:
                links.setdefault(gid, ("exact", 1.0))
                continue
            # 2. reviewed crosswalk row (alias, or macro-region expansion)
            rows = crosswalk.get((e["iso3"], e["source_id"], key))
            if rows:
                for row in rows:
                    if row["status"] == "rejected":
                        continue
                    confidence = 0.9 if row["status"] == "alias" else 0.5
                    links.setdefault(row["gid"], (row["status"], confidence))
                continue
            # 3. nothing placed it: queue it for review
            uk = (e["iso3"], e["source_id"], place.strip())
            entry = unmatched.setdefault(uk, {"occurrences": 0, "example_key": e["source_key"]})
            entry["occurrences"] += 1
        e["links"] = links
    return unmatched


# --------------------------------------------------------------------- writing


def write_db(path: Path, regions, countries, events, crosswalk, unmatched, sources):
    if path.exists():
        path.unlink()
    con = sqlite3.connect(path)
    con.executescript((HERE / "schema.sql").read_text())

    con.executemany(
        "INSERT INTO source VALUES (:source_id,:title,:publisher,:url,:licence,:retrieved,:notes)",
        sources)
    con.executemany("INSERT INTO region VALUES (:gid,:iso3,:name,:name_norm)", regions)
    con.executemany(
        "INSERT INTO country VALUES (:iso3,:name,:desinventar,:desinventar_span,"
        ":supported,:maintainer_note)", countries)

    for e in events:
        cur = con.execute(
            "INSERT INTO event (source_id,source_key,iso3,hazard,hazard_raw,start_date,end_date,"
            "deaths,affected,damage_usd,source_place,source_admin) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (e["source_id"], e["source_key"], e["iso3"], e["hazard"], e["hazard_raw"],
             e["start_date"], e["end_date"], e["deaths"], e["affected"], e["damage_usd"],
             e["source_place"], e["source_admin"]))
        con.executemany(
            "INSERT OR IGNORE INTO event_region VALUES (?,?,?,?)",
            [(cur.lastrowid, gid, method, conf) for gid, (method, conf) in e["links"].items()])

    for (iso3, source_id, name_norm), rows in crosswalk.items():
        for row in rows:
            con.execute("INSERT OR REPLACE INTO crosswalk VALUES (?,?,?,?,?,?,?,?,?)",
                        (iso3, source_id, row["source_name"], name_norm, row["gid"],
                         row["status"], row["note"], row["reviewed_by"], row["reviewed_on"]))

    con.executemany("INSERT INTO crosswalk_unmatched VALUES (?,?,?,?,?)",
                    [(i, s, n, v["occurrences"], v["example_key"])
                     for (i, s, n), v in sorted(unmatched.items())])

    con.executemany("INSERT INTO meta VALUES (?,?)", [
        ("schema_version", SCHEMA_VERSION),
        ("built_at", datetime.now(timezone.utc).isoformat(timespec="seconds")),
        ("events", str(len(events))),
        ("regions", str(len(regions))),
        ("unplaced_events", str(sum(1 for e in events if not e["links"]))),
        ("unmatched_places", str(len(unmatched))),
    ])
    con.commit()
    con.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=BACKEND / "data" / "catalogue.sqlite")
    ap.add_argument("--adm1", type=Path, default=BACKEND / "data" / "ea-adm1-geo.json")
    ap.add_argument("--emdat", type=Path, default=BACKEND / "data" / "emdat_ea_floods.json")
    ap.add_argument("--review", action="store_true", help="print the unresolved-place queue")
    args = ap.parse_args()

    regions = load_regions(args.adm1)
    countries = load_countries(HERE / "countries.csv")
    crosswalk, problems = load_crosswalk(HERE / "crosswalk", regions)
    if problems:
        for p in problems:
            print(f"crosswalk error: {p}", file=sys.stderr)
        sys.exit("crosswalk has errors; refusing to build a catalogue on a broken join")

    events = read_emdat(args.emdat) + read_desinventar(HERE / "sources") + \
        read_manual(HERE / "manual" / "events.csv")
    if not events:
        sys.exit("no events from any source; nothing to build")

    unmatched = resolve(events, regions, crosswalk)

    supported = {c["iso3"] for c in countries if c["supported"]}
    sources = [
        {"source_id": "emdat", "title": "EM-DAT International Disaster Database",
         "publisher": "CRED, UCLouvain", "url": "https://public.emdat.be/",
         "licence": "CC BY 4.0, non-commercial; cite CRED / UCLouvain",
         "retrieved": _iso(json.loads(args.emdat.read_text()).get("source_date"))
         if args.emdat.exists() else None,
         "notes": "parsed by tools/emdat/parse_emdat_export.py"},
        {"source_id": "desinventar", "title": "DesInventar Sendai national loss databases",
         "publisher": "UNDRR", "url": "https://www.desinventar.net/",
         # Provenance is the export file's own date: these databases are updated
         # continuously, so "which download" is the only meaningful version.
         "licence": "national institutions hold copyright in their own database; "
                    "proper citation required when quoting or reproducing",
         "retrieved": max(
             (datetime.fromtimestamp(f.stat().st_mtime, timezone.utc).date().isoformat()
              for f in (HERE / "sources").glob("*") if f.is_file()), default=None),
         "notes": "per-country XML exports under tools/catalogue/sources/; obtained via "
                  "download_base.jsp?countrycode=<code> or the admin module's "
                  "'Export Database in XML format', which yields a zip"},
        {"source_id": "manual", "title": "MUST manually maintained events",
         "publisher": "MUST", "url": None, "licence": "internal",
         "retrieved": None,
         "notes": f"covers countries no automated source reaches: "
                  f"{', '.join(sorted({c['iso3'] for c in countries if not c['supported']})) or 'none'}"},
    ]

    write_db(args.out, regions, countries, events, crosswalk, unmatched, sources)

    by_source: dict[str, int] = {}
    for e in events:
        by_source[e["source_id"]] = by_source.get(e["source_id"], 0) + 1
    unplaced = [e for e in events if not e["links"]]
    print(f"catalogue: {args.out}")
    print(f"  events    {len(events)} ({', '.join(f'{k} {v}' for k, v in sorted(by_source.items()))})")
    print(f"  regions   {len(regions)} admin-1 units, {len(supported)}/{len(countries)} countries automated")
    print(f"  links     {sum(len(e['links']) for e in events)} event-region rows")
    print(f"  unplaced  {len(unplaced)} events attributed to no region")
    print(f"  review    {len(unmatched)} distinct place names unresolved")
    if args.review and unmatched:
        print("\nreview queue (add rows to crosswalk/<source>.csv):")
        for (iso3, source_id, name), v in sorted(unmatched.items(),
                                                 key=lambda kv: -kv[1]["occurrences"]):
            print(f"  {iso3} {source_id:12s} {v['occurrences']:3d}x  {name!r}  (e.g. {v['example_key']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
