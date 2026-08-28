-- Missed-opportunity evaluation. Written into catalogue.sqlite by tools/moi/build_moi.py.
--
-- These tables live inside the catalogue file rather than a second database so
-- region, event and country are shared instead of copied. Rerun this build after
-- any catalogue rebuild: build_catalogue.py recreates the file and drops moi_*.
--
-- Three populations, kept apart because collapsing them is how a rainfall
-- forecast archive gets misread as a flood-warning scorecard:
--   moi_obs_extreme + moi_signal  what MUST can be scored on, no disaster record needed
--   moi_impact                    how much of the recorded burden is inside the hazard at all
--   moi_case                      the subset where both hold

DROP VIEW  IF EXISTS v_moi_anticipation;
DROP TABLE IF EXISTS moi_case;
DROP TABLE IF EXISTS moi_impact;
DROP TABLE IF EXISTS moi_signal;
DROP TABLE IF EXISTS moi_obs_extreme;
DROP TABLE IF EXISTS moi_coverage;
DROP TABLE IF EXISTS moi_meta;

-- Build provenance and every parameter the verdicts depend on; read whole by the service.
CREATE TABLE moi_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Where a country's loss record reaches into the forecast archive. Outside these
-- spans "no impact recorded" is missing data, so scorable = 0 leaves the denominator.
CREATE TABLE moi_coverage (
    iso3       TEXT PRIMARY KEY REFERENCES country(iso3),
    source_id  TEXT,                          -- NULL => nothing reaches this country
    first_day  TEXT,
    last_day   TEXT,
    events     INTEGER NOT NULL DEFAULT 0,
    scorable   INTEGER NOT NULL DEFAULT 0,
    note       TEXT
);

-- Observed unusual rainfall: one region-day per unit that cleared the confirmation bar.
-- The bar is fixed at moi_meta.obs_rp and does NOT move with the forecast return period:
-- the observation answers "did something unusual fall?", not "was it as rare as the warning".
CREATE TABLE moi_obs_extreme (
    valid_date  TEXT NOT NULL,
    gid         TEXT NOT NULL REFERENCES region(gid),
    obs_mm      REAL NOT NULL,               -- unit peak 24 h total
    rp_cleared  INTEGER NOT NULL,            -- highest return level cleared
    PRIMARY KEY (valid_date, gid)
);
CREATE INDEX moi_obs_extreme_date ON moi_obs_extreme(valid_date);

-- Member fraction clearing rp for one unit-day, split by how far ahead the run was issued.
-- Lead beyond 2 days is unresolvable: the store's lead axis jumps 72 -> 168 h in one block.
-- NULL is an absent run, never "no signal" -- a gap and a quiet forecast must not read alike.
CREATE TABLE moi_signal (
    valid_date  TEXT NOT NULL,
    gid         TEXT NOT NULL REFERENCES region(gid),
    rp          INTEGER NOT NULL,
    p_lead0     REAL,                        -- run issued the same day
    p_lead1     REAL,                        -- a day ahead: >= 24 h of warning
    p_lead2     REAL,                        -- two days ahead
    PRIMARY KEY (valid_date, gid, rp)
);
CREATE INDEX moi_signal_date ON moi_signal(valid_date, rp);

-- Scoring tier per catalogue event and unit. Dates, losses and iso3 stay in event/event_region.
--   assessable              an unusual rainfall event was observed in the unit
--   outside_rainfall_model  impact recorded, no observed extreme -- a hazard MUST does not forecast
--   span_too_long           a season-scale record, not a day's event
--   no_forecast             no run covers the span
CREATE TABLE moi_impact (
    event_id    INTEGER NOT NULL REFERENCES event(event_id),
    gid         TEXT NOT NULL REFERENCES region(gid),
    span_days   INTEGER NOT NULL,
    obs_mm      REAL,                        -- peak observed over the widened span
    obs_rp      INTEGER,                     -- NULL => measured, and not extreme
    tier        TEXT NOT NULL,
    PRIMARY KEY (event_id, gid)
);
CREATE INDEX moi_impact_tier ON moi_impact(tier);

-- Assessable events only, scored per return period.
--   missed_opportunity  a qualifying signal at an actionable lead, and the impact happened anyway
--   late_warning        the signal only appeared on the day itself
--   forecast_miss       no qualifying signal at any lead
-- warning_record is 'none_available' on every row: MUST holds no warning registry, so the
-- definition's third clause is unverified rather than satisfied. Stored, not defaulted, so the
-- gap sits in the rows instead of in prose -- and so a future advisory feed has a place to land.
CREATE TABLE moi_case (
    event_id       INTEGER NOT NULL,
    gid            TEXT NOT NULL REFERENCES region(gid),
    rp             INTEGER NOT NULL,
    p_best         REAL,                     -- strongest qualifying signal found
    p_lead0        REAL,
    best_lead_h    INTEGER,                  -- lead it was found at; NULL when none was
    verdict        TEXT NOT NULL,
    warning_record TEXT NOT NULL DEFAULT 'none_available',
    PRIMARY KEY (event_id, gid, rp)
);
CREATE INDEX moi_case_rp ON moi_case(rp, verdict);

-- The large-n verification: anticipation over observed extremes, no disaster record needed.
CREATE VIEW v_moi_anticipation AS
SELECT o.valid_date, o.gid, r.iso3, r.name, o.obs_mm, o.rp_cleared,
       s.rp, s.p_lead0, s.p_lead1, s.p_lead2
FROM moi_obs_extreme o
JOIN region r ON r.gid = o.gid
LEFT JOIN moi_signal s ON s.valid_date = o.valid_date AND s.gid = o.gid;
