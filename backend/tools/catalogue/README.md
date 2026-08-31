# MUST disaster catalogue

`data/catalogue.sqlite` holds recorded flood events from every source, each joined
to the admin-1 regions the app already renders. Built offline, mounted read-only,
never written by the service.

    uv run build_catalogue.py            # rebuild from whatever sources are present
    uv run build_catalogue.py --review   # rebuild, then print the unresolved-place queue

## Why a database and not another JSON blob

The EM-DAT feed was a flat JSON list, and the mapping from its prose place names
to admin-1 units lived in a dict inside `app/emdat.py`. That made the crosswalk
unreviewable: you could not ask *which events landed on Gedo and why*. Here every
link carries the method that produced it, so the weakest ones can be audited
first:

| method | confidence | meaning |
|---|---|---|
| `exact` | 1.0 | the source's name equals the admin-1 name, case- and punctuation-insensitive |
| `alias` | 0.9 | a reviewed 1:1 mapping — spelling, translation, or a child unit rolled up |
| `macro` | 0.5 | the source named a unit *larger* than admin-1, expanded to its members |
| `manual` | 1.0 | a hand-entered event that names its regions outright |

`macro` is deliberately half-confidence: "Puntland" tells you three regions were
in the affected area, not that all three flooded.

## Adding a source

Drop a UNDRR per-country export in `sources/` and rebuild. Either the zip the
admin module emits (`DI_export_<iso3>.zip`) or a bare `desinventar_<ISO3>.xml`
works; the ISO3 is read from the last underscore-separated part of the filename.
Only water-driven event types are ingested; the reader keeps each source's own
vocabulary in `event.hazard_raw` alongside the normalized `event.hazard`.

## The review loop

The build never guesses. A place name it cannot resolve goes to
`crosswalk_unmatched` instead of being dropped or approximated:

    sqlite3 ../../data/catalogue.sqlite \
      "SELECT iso3, source_name, occurrences, example_key FROM crosswalk_unmatched
       ORDER BY occurrences DESC"

To resolve one, add a row to `crosswalk/<source_id>.csv` and rebuild. Any status
other than `exact` requires a `note` saying why, and a `gid` that is not a real
admin-1 unit aborts the build rather than silently dropping the link.

Two counts in `meta` are the health of the whole thing, and `/xr/catalogue`
exposes both: `unmatched_places` (names awaiting review) and `unplaced_events`
(events attributed to no region at all, therefore invisible on every map).

## Countries with no automated source

`countries.csv` is the register. `supported=0` means no source reaches that
country, so its events are maintained by hand in `manual/events.csv`, where a row
names its `gids` directly and needs no crosswalk. This is a standing arrangement,
not a gap to be closed in code — the register and the manual file are the
supported way to carry such a country, and they are read on every build.

## Vintage warning

`data/ea-adm1-geo.json` is a mixed-vintage GADM extract: Kenya is the 47 post-2013
counties, Uganda is the 2001-era 58 districts, Ethiopia predates the 2020-23
break-up of SNNPR, and South Sudan's spellings are non-standard (`Jungoli`,
`Warap`). Most of the reviewed crosswalk exists to absorb exactly this, and every
such row says so in its note. Re-cutting the region layer means re-reviewing them.
