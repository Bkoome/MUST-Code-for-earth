# MUST missed-opportunity evaluation

```
uv run build_moi.py --store /path/to/ea_tp_8step --summary
cp ../../data/moi.sqlite ../../../Data/moi.sqlite    # into whatever /data is mounted from
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
    --catalogue /data/catalogue.sqlite --adm1 /data/ea-adm1-geo.json \
    --out /cache/moi.sqlite --summary
```

Builds `data/moi.sqlite` from the fields cache, the CMORPH return levels, IMERG
and the disaster catalogue. The service reads it read-only and simply turns the
feature off when the file is absent, the same way thresholds, IMERG, EM-DAT and
the catalogue already degrade.

## What this measures, and what it refuses to

MUST forecasts rainfall extremes. A flood-loss database records floods. Those
are not the same thing, and almost all of the difference is real: a flood routed
down from highland rain two days earlier, a river that crested after a dam
release, a city where 40 mm overwhelmed the drains. None of those leave an
unusual daily rainfall total in the unit they damage, and none of them are
things this system claims to predict.

So the build keeps three populations apart and never lets one stand in for
another.

**Anticipation** — `obs_extreme` joined to `signal`. Every region-day where
IMERG observed an unusual rainfall event, and what the ensemble said about it at
each lead. This needs no disaster record at all, so it spans every admin-1 unit
and every day in the archive, and it is the only population large enough to
verify the forecast on.

**Attribution** — `impact_event`. Every recorded flood, tiered by whether MUST
can be scored against it. The tier that matters is `outside_rainfall_model`:
impact recorded, no observed rainfall extreme in the unit. Those events are not
forecast failures and must never be counted as missed warnings. The share of the
recorded burden that lands in that tier is the honest statement of how much of
East Africa's flood problem is inside this system's reach.

**Cases** — `moi_case`. The intersection: impact recorded *and* an unusual
rainfall event observed. Only here does "missed opportunity" mean anything, and
the population is small enough that it is a ledger of named events, not a rate.
A percentage over single digits is theatre.

## The parameters

Every one of these is written into `meta`, because a reader who cannot see the
thresholds cannot judge the counts.

| parameter | value | why |
| --- | --- | --- |
| `strong_p` | 0.15 | The share of the ensemble over the return level that counts as a qualifying signal. Not a new number: it is the Moderate boundary `severityState()` already draws at in the frontend, so a calendar cell and a verdict cannot disagree. |
| `obs_rp` | 2 yr | The confirmation bar, deliberately **not** tied to the forecast return period. |
| `lead_days` | 0, 1, 2 | All the store can resolve. |
| `join_tolerance_days` | 1 | DesInventar dates the day flooding was noticed, often the morning after the rain. |
| `max_scored_span_days` | 7 | A longer record is a season, not a day's event. |
| `impact_source` | `desinventar` | EM-DAT is excluded from scoring. |

### Why the observation bar is fixed

The forecast return period asks *how rare was the thing we warned about*. The
observation asks *did something unusual actually fall*. Tying them together
answers neither: at a matched 10-yr bar IMERG confirms 194 region-days in three
and a half years, the assessable population collapses to nothing, and the index
reports zero at the default setting — not because the forecasts were good but
because the question was unanswerable.

### Why EM-DAT is not scored

Its admin-1 links are prose matches expanded from named macro-regions: 36 events
carry 326 unit links between them, one record naming 45 counties. That is fine
for a reader's ledger, where it says "somewhere in here", and useless as ground
truth for a per-unit verdict. DesInventar names one unit per record.

### Why a country can be unscorable

A loss database that stops before the forecast archive starts cannot be silent
about a flood — it can only be absent. Djibouti's DesInventar ends in 2011,
Rwanda's in 2019, Uganda's in 2021; Burundi, Eritrea, Sudan and South Sudan have
none. Inside the archive only Ethiopia, Somalia, Tanzania and Kenya carry
admin-1 records. `coverage.scorable` marks the rest, they leave the denominator,
and the map hatches them. A quiet unit in an uncovered country must never read
as a warning that worked.

## What the file cannot tell you

**Whether a warning was issued.** The definition of a missed opportunity ends
"...but the available record contains no corresponding documented warning or
action". MUST holds no warning registry, so that clause is *unverified*, not
satisfied. `moi_case.warning_record` says `none_available` on every row so the
gap is visible in the data rather than buried in prose, and so a future advisory
feed lands in a column already shaped for it.

**Forecast quality, from the false-alarm ratio alone.** The `--summary`
contingency table reports one, and it is inflated by a scale mismatch that has
nothing to do with skill: the forecast side takes a maximum over 51 members
*and* over every cell in a unit, while the observation side is a single
deterministic field regridded from 0.1° to 0.4°. Do not publish that number as a
headline result. A thresholded 2×2 is in any case the wrong instrument for a
51-member ensemble — reliability and ROC over the observed-extreme population
use the distribution instead of collapsing it at 0.15, and that is where this
should go next.

## Rebuilding

The signal side reads `cache/fields/*.npz`, the per-member `[0,w]` accumulations
`app/derive.py` already writes, and recovers each lead day by subtraction:
`W(24(k+1)) − W(24k)`. No store field is ever read, so a rebuild costs nothing
beyond disk. The store is opened only for its `lat`/`lon`/`member` axes, so that
the masks, thresholds and observations land on exactly the grid the service
derives on.

A zero-length or truncated `.npz` is reported and left as a `NULL` signal, never
as a quiet forecast. If the count in `meta.unreadable_field_files` is not empty,
delete those files and request any tile for those dates — `derive.member_windows`
recomputes and rewrites the cache — then rebuild.
