-- Missed-opportunity evaluation, built offline by tools/moi/build_moi.py.
--
-- Three populations live here, deliberately kept apart, because collapsing
-- them is how a rainfall-forecast archive gets misread as a flood-warning
-- scorecard:
--
--   obs_extreme + signal   what MUST can be scored on. Every region-day where
--                          an unusual rainfall event was observed, and what the
--                          ensemble said about it at each lead. Needs no
--                          disaster record, so it spans the whole domain.
--
--   impact_event           how much of the recorded flood burden is inside
--                          MUST's hazard at all. Most of it is not: a flood
--                          routed from upstream, or a drainage failure, leaves
--                          no rainfall extreme in the unit it damages.
--
--   moi_case               the subset where both hold, and only there does
--                          "missed opportunity" mean anything.
--
-- Written once and read read-only by app/moi.py.

PRAGMA journal_mode = DELETE;

-- ---------------------------------------------------------------- provenance

-- Build provenance and every parameter the verdicts depend on. Read whole by
-- the service: a reader who cannot see the thresholds cannot judge the counts.
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- ------------------------------------------------------------ region universe

-- The admin-1 layer as it was at build time, so the file answers on its own.
CREATE TABLE region (
    gid   TEXT PRIMARY KEY,   -- e.g. 'BDI.1_1', matches regions.meta()
    iso3  TEXT NOT NULL,
    name  TEXT NOT NULL
);
CREATE INDEX region_iso ON region(iso3);

-- ------------------------------------------------------------------ coverage

-- Where an admin-1 impact record actually exists inside the forecast archive.
-- Outside these spans "no impact recorded" is missing data, not a quiet day,
-- and a unit in an unscorable country must never count as a warning that
-- worked. scorable = 0 drives the hatching and leaves the denominator.
CREATE TABLE coverage (
    iso3       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    source_id  TEXT,                          -- NULL => nothing reaches this country
    first_day  TEXT,                          -- first recorded day inside the archive
    last_day   TEXT,
    events     INTEGER NOT NULL DEFAULT 0,
    scorable   INTEGER NOT NULL DEFAULT 0,    -- 0 => leaves the denominator, hatched
    note       TEXT
);

-- -------------------------------------------------------------- observations

-- Observed unusual rainfall: one row per region-day where IMERG cleared the
-- confirmation bar somewhere in the unit. The bar is a fixed return period
-- (see meta.obs_rp) and does NOT move with the forecast return period — the
-- observation answers "did something unusual actually fall?", not "was it as
-- rare as the thing we warned about". rp_cleared is the highest level cleared.
CREATE TABLE obs_extreme (
    valid_date  TEXT NOT NULL,
    gid         TEXT NOT NULL REFERENCES region(gid),
    obs_mm      REAL NOT NULL,               -- unit peak 24 h total
    rp_cleared  INTEGER NOT NULL,            -- highest return level cleared, >= meta.obs_rp
    PRIMARY KEY (valid_date, gid)
);
CREATE INDEX obs_extreme_date ON obs_extreme(valid_date);

-- -------------------------------------------------------------------- signal

-- What the ensemble said about one unit on one day, per return period, split
-- by how far ahead the run was issued. p_lead1 is the run from the day before
-- (>= 24 h of warning), p_lead2 the day before that. Lead beyond 2 days cannot
-- be resolved: the store carries lead steps [0,3,6,12,24,48,72,168], so 72->168
-- is a single four-day block that no daily accumulation can be recovered from.
--
-- NULL means the run is unavailable, never "no signal" — a gap in the archive
-- and a quiet forecast must not read alike.
CREATE TABLE signal (
    valid_date  TEXT NOT NULL,
    gid         TEXT NOT NULL REFERENCES region(gid),
    rp          INTEGER NOT NULL,           -- forecast return period being cleared
    p_lead0     REAL,                       -- run issued the same day
    p_lead1     REAL,                       -- run issued a day ahead: >= 24 h of warning
    p_lead2     REAL,                       -- two days ahead
    PRIMARY KEY (valid_date, gid, rp)
);
CREATE INDEX signal_date ON signal(valid_date, rp);

-- ------------------------------------------------------------------- impact

-- Recorded flood events joined to one admin-1 unit, each with the tier that
-- says whether MUST can be scored against it at all.
--
--   assessable              an unusual rainfall event was observed in the unit
--   outside_rainfall_model  impact recorded, no observed rainfall extreme. NOT
--                           a forecast failure: the hazard that caused it is
--                           not the hazard this system forecasts.
--   no_impact_source        the country has no admin-1 loss record in the window
--   span_too_long           a season-scale record, not a day's event
--   no_forecast             no run covers the span
CREATE TABLE impact_event (
    event_id    INTEGER NOT NULL,
    source_id   TEXT NOT NULL,
    source_key  TEXT,
    iso3        TEXT NOT NULL,
    gid         TEXT NOT NULL REFERENCES region(gid),
    start_date  TEXT NOT NULL,
    end_date    TEXT NOT NULL,
    span_days   INTEGER NOT NULL,
    deaths      INTEGER,
    affected    INTEGER,
    obs_mm      REAL,                        -- peak observed over the widened span
    obs_rp      INTEGER,                     -- NULL => measured, and not extreme
    tier        TEXT NOT NULL,               -- see the list above
    PRIMARY KEY (event_id, gid)
);
CREATE INDEX impact_event_tier ON impact_event(tier);
CREATE INDEX impact_event_date ON impact_event(start_date, end_date);

-- -------------------------------------------------------------------- cases

-- The assessable events only, scored per return period.
--
--   missed_opportunity  a qualifying signal existed at an actionable lead and
--                       the impact happened anyway
--   late_warning        the signal only appeared on the day itself
--   forecast_miss       no qualifying signal at any lead
--
-- warning_record is 'none_available' on every row and is not evidence. The
-- definition asks whether a documented warning or action exists; MUST holds no
-- warning registry, so the clause is unverified rather than satisfied. The
-- column exists so that a future advisory feed lands in a place already shaped
-- for it, and so the gap is visible in the data instead of buried in prose.
CREATE TABLE moi_case (
    event_id       INTEGER NOT NULL,
    gid            TEXT NOT NULL REFERENCES region(gid),
    rp             INTEGER NOT NULL,
    p_best         REAL,                    -- strongest qualifying signal found
    p_lead0        REAL,
    best_lead_h    INTEGER,                 -- lead it was found at; NULL when none was
    verdict        TEXT NOT NULL,
    warning_record TEXT NOT NULL DEFAULT 'none_available',
    PRIMARY KEY (event_id, gid, rp)
);
CREATE INDEX moi_case_rp ON moi_case(rp, verdict);

-- --------------------------------------------------------------------- views

-- Anticipation over the observed-extreme population: the large-n verification,
-- which needs no disaster record and therefore covers every unit and every day.
CREATE VIEW v_anticipation AS
SELECT o.valid_date, o.gid, r.iso3, r.name, o.obs_mm, o.rp_cleared,
       s.rp, s.p_lead0, s.p_lead1, s.p_lead2
FROM obs_extreme o
JOIN region r ON r.gid = o.gid
LEFT JOIN signal s ON s.valid_date = o.valid_date AND s.gid = o.gid;
