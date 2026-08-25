// Recorded disaster events from the backend catalogue, joined to admin-1 units.
// Mirrors app/catalogue.py; see tools/catalogue/README.md for how links are made.

// How an event was attributed to a region. `macro` is deliberately weak: the
// source named a unit larger than admin-1, so the event touched the area but
// not necessarily every region expanded from it.
export type MatchMethod = 'exact' | 'alias' | 'macro' | 'manual';

export interface EventRegion {
  gid: string;
  name: string;
  method: MatchMethod;
  confidence: number;
}

export interface CatalogueEvent {
  event_id: number;
  source: string;
  event_key: string;
  iso: string;
  hazard: string;
  start: string;
  end: string;
  deaths: number | null;
  affected: number | null;
  damage_usd: number | null;
  place: string | null;
  regions: EventRegion[];
}

// One day's recorded events. `gids` is every admin-1 unit any event touched,
// pre-flattened so the map can shade without walking the event list.
export interface DayEvents {
  date: string;
  count: number;
  gids: string[];
  data: CatalogueEvent[];
}

export interface CatalogueSource {
  source_id: string;
  title: string;
  publisher: string | null;
  url: string | null;
  licence: string | null;
  retrieved: string | null;
}

export interface CatalogueCountry {
  iso3: string;
  name: string;
  desinventar: string;
  maintainer_note: string;
}

export interface CatalogueInfo {
  // Build provenance. unplaced_events and unmatched_places are the crosswalk's
  // own failure counts, carried through so a data gap is never read as calm.
  meta: Record<string, string>;
  sources: CatalogueSource[];
  manually_maintained: CatalogueCountry[];
}

export const HAZARD_LABEL: Record<string, string> = {
  flood: 'Flood',
  flash_flood: 'Flash flood',
  heavy_rain: 'Heavy rain',
};

export const SOURCE_LABEL: Record<string, string> = {
  emdat: 'EM-DAT',
  desinventar: 'DesInventar',
  manual: 'MUST',
};
