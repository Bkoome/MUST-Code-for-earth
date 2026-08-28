# MUST missed-opportunity evaluation

```
uv run build_moi.py --store /path/to/ea_tp_8step --summary
cp ../../data/catalogue.sqlite ../../../Data/       # into whatever /data is mounted from
```

Or inside the service image, which pins the tool to exactly the xarray, rasterio
and icechunk the service itself derives with — worth preferring when the numbers
are going anywhere:

```
docker compose run --rm --no-deps -v "$PWD/backend/tools:/srv/tools:ro" \
  titiler-xarray python /srv/tools/moi/build_moi.py \
    --store /store --fields /cache/fields \
    --thresholds /data/cmorph_ea_return_periods.nc \
    --imerg /data/gpm_imerg_ea_daily.nc \
    --catalogue /data/catalogue.sqlite --adm1 /data/ea-adm1-geo.json --summary
```

Reads the fields cache, the CMORPH return levels, IMERG and the disaster
catalogue, then writes the `moi_*` tables back into `catalogue.sqlite`. One
database, so `region`, `event` and `country` are shared rather than copied — and
so there is one artifact to build, mount and keep in step.

**Run this after any catalogue rebuild.** `build_catalogue.py` recreates the file
from scratch and takes the `moi_*` tables with it. The service reads the tables
read-only and turns the feature off when they are absent, the same way
thresholds, IMERG, EM-DAT and the catalogue already degrade.

## What this measures, and what it refuses to

MUST forecasts rainfall extremes; a flood-loss database records floods. Most of the
difference is real — highland rain routed downstream, a river crest, a city where
40 mm overwhelmed the drains — and none of it leaves an unusual daily rainfall total
in the unit it damages. So three populations are kept apart and never substituted:

- **Anticipation** — `moi_obs_extreme` joined to `moi_signal`. Every region-day IMERG
  saw an unusual rainfall event, and what the ensemble said at each lead. Needs no
  disaster record, so it spans the whole archive and is the only population large
  enough to verify on.
- **Attribution** — `moi_impact`. Every recorded flood, tiered by whether MUST can be
  scored against it. `outside_rainfall_model` is the tier that matters: impact
  recorded, no observed extreme. Those are not forecast failures, and their share is
  the honest statement of how much of the problem is inside this system's reach.
- **Cases** — `moi_case`. The intersection, and the only place "missed opportunity"
  means anything. Small enough to be a ledger of named events; a percentage over five
  of them would be theatre.

## The parameters

All written into `moi_meta`: thresholds a reader cannot see are counts they cannot judge.

| parameter | value | why |
| --- | --- | --- |
| `strong_p` | 0.15 | Share of the ensemble over the return level that qualifies. Not a new number — it is the Moderate boundary `severityState()` already draws at, so a calendar cell and a verdict cannot disagree. |
| `obs_rp` | 2 yr | The confirmation bar, deliberately **not** tied to the forecast return period. |
| `lead_days` | 0, 1, 2 | All the store's lead axis can resolve. |
| `join_tolerance_days` | 1 | DesInventar dates the day flooding was noticed, often the morning after. |
| `max_scored_span_days` | 7 | Longer is a season, not a day's event. |
| `impact_source` | `desinventar` | EM-DAT is excluded from scoring. |

**Why the observation bar is fixed.** The forecast rp asks how rare the warned-about
thing was; the observation asks whether something unusual fell. Tying them answers
neither: at a matched 10-yr bar IMERG confirms 194 region-days in three and a half
years and the assessable population collapses — the index would report zero because
the question was unanswerable, not because the forecasts were good.

**Why EM-DAT is not scored.** Its admin-1 links are prose matches expanded from macro
regions: 36 events carry 326 unit links, one record naming 45 counties. Fine for a
reader's ledger, useless as per-unit ground truth. DesInventar names one unit per record.

**Why a country can be unscorable.** A loss database ending before the archive starts
cannot be silent about a flood, only absent — Djibouti's ends 2011, Rwanda's 2019,
Uganda's 2021; Burundi, Eritrea, Sudan and South Sudan have none. Only ETH, SOM, TZA
and KEN carry admin-1 records inside the archive. `moi_coverage.scorable` marks the
rest: they leave the denominator and the map hatches them.

## What the file cannot tell you

**Whether a warning was issued.** The definition ends "...no corresponding documented
warning or action". MUST holds no warning registry, so that clause is *unverified*,
not satisfied. `moi_case.warning_record` says `none_available` on every row, keeping
the gap in the data rather than in prose, and leaving a column a future advisory feed
can land in.

**Forecast quality from the false-alarm ratio alone.** `--summary` prints one, inflated
by a scale mismatch that has nothing to do with skill: the forecast side maxes over 51
members and every cell in a unit, the observation side is one deterministic field
regridded 0.1° to 0.4°. A thresholded 2x2 is the wrong instrument for a 51-member
ensemble anyway — reliability and ROC over the observed-extreme population are the
next move.

## Rebuilding

The signal side reads `cache/fields/*.npz` — the per-member `[0,w]` accumulations
`app/derive.py` already writes — and recovers each lead day by subtraction,
`W(24(k+1)) - W(24k)`. No store field is ever read; the store is opened only for its
`lat`/`lon`/`member` axes, so masks, thresholds and observations land on exactly the
grid the service derives on.

A zero-length or truncated `.npz` is reported and left as a `NULL` signal, never as a
quiet forecast. If `moi_meta.unreadable_field_files` is not empty, delete those files,
request any tile for those dates (`derive.member_windows` rewrites the cache), rebuild.
