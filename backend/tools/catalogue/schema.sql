-- MUST disaster catalogue: multi-source flood events joined to admin-1 regions.
--
-- Built offline by build_catalogue.py into data/catalogue.sqlite and mounted
-- read-only into the backend. Deliberately small: the whole point is that a
-- reviewer can open it with the sqlite3 CLI and see why any event landed on any
-- region, and can correct that decision by editing a CSV under crosswalk/.

PRAGMA journal_mode = DELETE;  -- a read-only mount cannot host a WAL sidecar

-- ---------------------------------------------------------------- provenance

CREATE TABLE source (
    source_id   TEXT PRIMARY KEY,   -- 'emdat', 'desinventar', 'manual'
    title       TEXT NOT NULL,
    publisher   TEXT,
    url         TEXT,
    licence     TEXT,               -- redistribution terms; the app is public
    retrieved   TEXT,               -- ISO date the raw export was obtained
    notes       TEXT
);

-- ------------------------------------------------------------ region universe

-- Mirrored from data/ea-adm1-geo.json so every join is checkable inside the DB
-- rather than against a file the reviewer cannot query.
CREATE TABLE region (
    gid        TEXT PRIMARY KEY,    -- e.g. 'BDI.1_1', matches regions.meta()
    iso3       TEXT NOT NULL,
    name       TEXT NOT NULL,
    name_norm  TEXT NOT NULL        -- lowercase a-z only, the join key
);
CREATE INDEX region_iso ON region(iso3);
CREATE INDEX region_norm ON region(iso3, name_norm);

-- Support status per country. A country with no DesInventar database is not a
-- bug to be fixed in code: it is a standing fact that a human maintains events
-- for, so it is recorded here and read by the build.
CREATE TABLE country (
    iso3             TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    desinventar      TEXT NOT NULL,  -- 'yes' | 'no' | 'stale' | 'unknown'
    desinventar_span TEXT,           -- coverage period as published, free text
    supported        INTEGER NOT NULL DEFAULT 1,  -- 0 => manual maintenance only
    maintainer_note  TEXT
);

-- ------------------------------------------------------------------- events

CREATE TABLE event (
    event_id      INTEGER PRIMARY KEY,
    source_id     TEXT NOT NULL REFERENCES source(source_id),
    source_key    TEXT NOT NULL,     -- EM-DAT DisNo., DesInventar serial, manual id
    iso3          TEXT NOT NULL,
    hazard        TEXT NOT NULL,     -- normalized: 'flood', 'flash_flood', 'storm', ...
    hazard_raw    TEXT,              -- the source's own vocabulary, kept verbatim
    start_date    TEXT NOT NULL,     -- YYYY-MM-DD
    end_date      TEXT NOT NULL,     -- >= start_date; equals start when open-ended
    deaths        INTEGER,
    affected      INTEGER,
    damage_usd    REAL,
    source_place  TEXT,              -- the raw location text the crosswalk read
    source_admin  TEXT,              -- source's own structured admin payload, JSON
    UNIQUE (source_id, source_key)
);
CREATE INDEX event_dates ON event(start_date, end_date);
CREATE INDEX event_iso ON event(iso3);

-- Resolved event -> admin-1 links. match_method records HOW the link was made,
-- so a reviewer can audit the weakest links first rather than trusting them all
-- equally.
CREATE TABLE event_region (
    event_id     INTEGER NOT NULL REFERENCES event(event_id) ON DELETE CASCADE,
    gid          TEXT NOT NULL REFERENCES region(gid),
    match_method TEXT NOT NULL,      -- 'exact' | 'alias' | 'macro' | 'admin_code' | 'manual'
    confidence   REAL NOT NULL,      -- 1.0 reviewed-exact .. 0.5 macro expansion
    PRIMARY KEY (event_id, gid)
);
CREATE INDEX event_region_gid ON event_region(gid);

-- ----------------------------------------------------------------- crosswalk

-- The reviewed geographic crosswalk. One row = "this source's place name, in
-- this country, means this admin-1 unit". Loaded from crosswalk/*.csv, which is
-- the file a human edits; nothing here is inferred at read time.
CREATE TABLE crosswalk (
    iso3            TEXT NOT NULL,
    source_id       TEXT NOT NULL,
    source_name     TEXT NOT NULL,   -- as written by the source
    source_name_norm TEXT NOT NULL,
    gid             TEXT NOT NULL REFERENCES region(gid),
    status          TEXT NOT NULL,   -- 'exact' | 'alias' | 'macro' | 'rejected'
    note            TEXT,            -- why; required for anything but 'exact'
    reviewed_by     TEXT,
    reviewed_on     TEXT,
    PRIMARY KEY (iso3, source_id, source_name_norm, gid)
);

-- The review queue: source place names no rule could resolve. The build refills
-- this every run, so it is a live worklist rather than a historical log. An
-- entry here means events exist that are NOT attributed to any region.
CREATE TABLE crosswalk_unmatched (
    iso3        TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    source_name TEXT NOT NULL,
    occurrences INTEGER NOT NULL,
    example_key TEXT,                -- one source_key exhibiting it, to look up
    PRIMARY KEY (iso3, source_id, source_name)
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- --------------------------------------------------------------------- views

-- What the app reads: one row per (event, region) with everything needed to
-- render, so the service issues one query and no joins of its own.
CREATE VIEW v_event_region AS
SELECT e.event_id, e.source_id, e.source_key, e.iso3, e.hazard,
       e.start_date, e.end_date, e.deaths, e.affected, e.damage_usd,
       er.gid, r.name AS region_name, er.match_method, er.confidence
FROM event e
JOIN event_region er ON er.event_id = e.event_id
JOIN region r ON r.gid = er.gid;
