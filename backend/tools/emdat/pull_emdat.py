#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""Pull East Africa flood records from the EM-DAT GraphQL API into a JSON feed.

Filters the public EM-DAT table to hydrological floods over the 11 ICPAC
countries and writes a normalized events file the titiler-xarray backend loads
to mark EM-DAT-verified days/regions on the storymap.

Auth: set EMDAT_API_KEY (from your account at https://api.emdat.be/) in the
environment. Usage: EMDAT_API_KEY=... uv run pull_emdat.py
"""

import argparse
import json
import os
import sys
from pathlib import Path

import requests

ENDPOINT = "https://api.emdat.be/v1"

# ICPAC / East Africa domain, aligned with data/ea-adm1-geo.json.
EA_ISO3 = ["BDI", "DJI", "ERI", "ETH", "KEN", "RWA", "SDN", "SOM", "SSD", "TZA", "UGA"]

# EM-DAT classification wildcard for the "Flood" disaster type.
FLOOD_CLASSIF = "nat-hyd-flo-*"

# GraphQL fields: identity, temporality, location text, structured admin units, impacts.
QUERY = """
query ea_floods($iso: [String!], $classif: [String!]) {
  api_version
  public_emdat(
    filters: { iso: $iso, classif: $classif, include_hist: true }
    cursor: { limit: -1 }
  ) {
    total_available
    info { timestamp version }
    data {
      disno
      classif_key
      iso
      country
      start_year
      start_month
      start_day
      end_year
      end_month
      end_day
      river_basin
      location
      admin_units
      total_deaths
      total_affected
      total_dam
      last_update
    }
  }
}
"""


def _iso_date(year, month, day, end):
    """Compose YYYY-MM-DD, defaulting missing parts to the widest plausible span."""
    if not year:
        return None
    month = month or (12 if end else 1)
    day = day or (28 if end else 1)
    return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"


def _normalize(row):
    """Flatten one EM-DAT record into the backend's event shape."""
    return {
        "disno": row.get("disno"),
        "classif_key": row.get("classif_key"),
        "iso": row.get("iso"),
        "country": row.get("country"),
        "start": _iso_date(row.get("start_year"), row.get("start_month"), row.get("start_day"), end=False),
        "end": _iso_date(row.get("end_year"), row.get("end_month"), row.get("end_day"), end=True),
        "river_basin": row.get("river_basin"),
        "location": row.get("location"),
        "admin_units": row.get("admin_units"),
        "total_deaths": row.get("total_deaths"),
        "total_affected": row.get("total_affected"),
        "total_dam": row.get("total_dam"),
        "last_update": row.get("last_update"),
    }


def fetch(api_key):
    """Run the flood query and return the public_emdat payload, raising on API errors."""
    resp = requests.post(
        ENDPOINT,
        json={"query": QUERY, "variables": {"iso": EA_ISO3, "classif": [FLOOD_CLASSIF]}},
        headers={"Authorization": api_key, "Content-Type": "application/json"},
        timeout=120,
    )
    if resp.status_code == 401:
        sys.exit("EM-DAT rejected the API key (401). Check EMDAT_API_KEY.")
    resp.raise_for_status()
    body = resp.json()
    if body.get("errors"):
        sys.exit(f"EM-DAT GraphQL errors: {json.dumps(body['errors'], indent=2)}")
    return body["data"]


def main():
    parser = argparse.ArgumentParser(description="Pull EA flood records from EM-DAT")
    parser.add_argument("--out", type=Path, default=Path(__file__).parent / "data" / "emdat_ea_floods.json")
    args = parser.parse_args()

    api_key = os.environ.get("EMDAT_API_KEY")
    if not api_key:
        sys.exit("Set EMDAT_API_KEY in the environment (get it from https://api.emdat.be/).")

    data = fetch(api_key)
    payload = data["public_emdat"]
    events = [_normalize(r) for r in payload["data"]]
    events.sort(key=lambda e: e["start"] or "")

    out = {
        "source": "EM-DAT public table",
        "api_version": data.get("api_version"),
        "emdat_version": payload["info"]["version"],
        "pulled_at": payload["info"]["timestamp"],
        "iso3": EA_ISO3,
        "classif": FLOOD_CLASSIF,
        "count": len(events),
        "events": events,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=2))

    print(f"pulled {len(events)} EA flood events (EM-DAT v{payload['info']['version']}) -> {args.out}")
    with_dates = [e for e in events if e["start"]]
    if with_dates:
        print(f"date span: {with_dates[0]['start']} .. {max(e['start'] for e in with_dates)}")
    top = sorted(events, key=lambda e: e.get("total_deaths") or 0, reverse=True)[:5]
    print("deadliest:")
    for e in top:
        print(f"  {e['disno']} {e['country']} {e['start']}..{e['end']} deaths={e['total_deaths']} affected={e['total_affected']}")


if __name__ == "__main__":
    main()
