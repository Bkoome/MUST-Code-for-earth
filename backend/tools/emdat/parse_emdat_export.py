#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "openpyxl"]
# ///
"""Parse an EM-DAT public "Access Data" Excel export into the backend flood feed.

Download from https://public.emdat.be/ (Access Data tab) with Disaster Type =
Flood and the East Africa countries selected, then run:
    uv run parse_emdat_export.py <export.xlsx>

Writes data/emdat_ea_floods.json in the same shape as the API puller, keeping
only hydrological floods over the 11 ICPAC countries.
"""

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

# ICPAC / East Africa domain, aligned with data/ea-adm1-geo.json.
EA_ISO3 = {"BDI", "DJI", "ERI", "ETH", "KEN", "RWA", "SDN", "SOM", "SSD", "TZA", "UGA"}

# EM-DAT export headers vary by casing/punctuation, so match on a normalized key.
COLUMNS = {
    "disno": ["disno"],
    "classif_key": ["classificationkey", "classifkey"],
    "disaster_type": ["disastertype"],
    "iso": ["iso"],
    "country": ["country"],
    "river_basin": ["riverbasin"],
    "location": ["location"],
    "admin_units": ["adminunits"],
    "start_year": ["startyear"],
    "start_month": ["startmonth"],
    "start_day": ["startday"],
    "end_year": ["endyear"],
    "end_month": ["endmonth"],
    "end_day": ["endday"],
    "total_deaths": ["totaldeaths"],
    "total_affected": ["totalaffected"],
    "total_dam": ["totaldamage000us", "totaldamageus", "totaldamage"],
    "last_update": ["lastupdate"],
}


def _norm(name):
    """Lowercase a header and strip everything but a-z0-9 for tolerant matching."""
    return "".join(c for c in str(name).lower() if c.isalnum())


def _resolve(df):
    """Map each logical field to the actual export column, or None when absent."""
    lookup = {_norm(c): c for c in df.columns}
    resolved = {}
    for field, candidates in COLUMNS.items():
        resolved[field] = next((lookup[c] for c in candidates if c in lookup), None)
    if resolved["disno"] is None:
        sys.exit("No 'DisNo.' column found - is this an EM-DAT export?")
    return resolved


def _int(value):
    """Coerce a spreadsheet cell to int, treating blanks/NaN as None."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _iso_date(year, month, day, end):
    """Compose YYYY-MM-DD, defaulting missing parts to the widest plausible span."""
    if not year:
        return None
    month = month or (12 if end else 1)
    day = day or (28 if end else 1)
    return f"{year:04d}-{month:02d}-{day:02d}"


def _admin_units(raw):
    """EM-DAT stores admin units as a JSON string; parse it, else pass text through."""
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    if isinstance(raw, (list, dict)):
        return raw
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return str(raw)


def _cell(row, col):
    """Read a resolved column from a row, or None when the column is missing."""
    if col is None:
        return None
    value = row[col]
    return None if (isinstance(value, float) and pd.isna(value)) else value


def main():
    parser = argparse.ArgumentParser(description="Parse an EM-DAT Excel export")
    parser.add_argument("export", type=Path, help="Path to the EM-DAT .xlsx export")
    parser.add_argument("--out", type=Path, default=Path(__file__).parent.parent / "data" / "emdat_ea_floods.json")
    args = parser.parse_args()

    if not args.export.exists():
        sys.exit(f"Export not found: {args.export}")

    df = pd.read_excel(args.export, engine="openpyxl")
    cols = _resolve(df)

    events = []
    for _, row in df.iterrows():
        iso = _cell(row, cols["iso"])
        dtype = str(_cell(row, cols["disaster_type"]) or "")
        classif = str(_cell(row, cols["classif_key"]) or "")
        is_flood = "flood" in dtype.lower() or classif.startswith("nat-hyd-flo")
        if iso not in EA_ISO3 or not is_flood:
            continue
        events.append({
            "disno": _cell(row, cols["disno"]),
            "classif_key": _cell(row, cols["classif_key"]),
            "iso": iso,
            "country": _cell(row, cols["country"]),
            "start": _iso_date(_int(_cell(row, cols["start_year"])), _int(_cell(row, cols["start_month"])), _int(_cell(row, cols["start_day"])), end=False),
            "end": _iso_date(_int(_cell(row, cols["end_year"])), _int(_cell(row, cols["end_month"])), _int(_cell(row, cols["end_day"])), end=True),
            "river_basin": _cell(row, cols["river_basin"]),
            "location": _cell(row, cols["location"]),
            "admin_units": _admin_units(_cell(row, cols["admin_units"])),
            "total_deaths": _int(_cell(row, cols["total_deaths"])),
            "total_affected": _int(_cell(row, cols["total_affected"])),
            "total_dam": _int(_cell(row, cols["total_dam"])),
            "last_update": _cell(row, cols["last_update"]),
        })

    events.sort(key=lambda e: e["start"] or "")
    out = {
        "source": f"EM-DAT public export ({args.export.name})",
        "iso3": sorted(EA_ISO3),
        "count": len(events),
        "events": events,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=2, default=str))

    print(f"parsed {len(events)} EA flood events -> {args.out}")
    dated = [e for e in events if e["start"]]
    if dated:
        print(f"date span: {dated[0]['start']} .. {max(e['start'] for e in dated)}")
    for e in sorted(events, key=lambda e: e.get("total_deaths") or 0, reverse=True)[:5]:
        print(f"  {e['disno']} {e['country']} {e['start']}..{e['end']} deaths={e['total_deaths']} affected={e['total_affected']}")


if __name__ == "__main__":
    main()
