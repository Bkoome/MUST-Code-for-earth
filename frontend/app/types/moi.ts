// Per-day evaluation: did the ensemble see this day's flooding coming?
//
// The backend keeps three populations apart (anticipation, attribution, cases).
// This widget reads only the third view — one day, one verdict — because that is
// the question a reader asks of a calendar cell. The rates live in the caveats.

export type Verdict =
  | 'missed_opportunity'
  | 'late_warning'
  | 'forecast_miss'
  | 'outside_rainfall_model'
  | 'no_recorded_impact'
  | 'no_impact_data';

// The four verdicts that mean a flood was actually recorded that day. They rank
// above the observation-only two, so a day whose worst verdict is one of these
// is exactly a day with a recorded flood — which is what the calendar dot marks.
export const RECORDED: ReadonlySet<string> = new Set<Verdict>([
  'missed_opportunity',
  'late_warning',
  'forecast_miss',
  'outside_rainfall_model',
]);

export interface MoiEvent {
  event_id: number;
  source: string;
  event_key: string;
  start: string;
  end: string;
  span_days: number;
  deaths: number | null;
  affected: number | null;
  obs_mm: number | null;
  tier: string;
  warning_record: string | null;
}

export interface MoiUnit {
  gid: string;
  name: string | null;
  iso3: string | null;
  verdict: Verdict;
  obs_mm: number | null;
  obs_rp: number | null;
  anticipated: boolean;
  p_best: number | null;
  lead_h: number | null;
  event: MoiEvent | null;
}

// /xr/moi/{date} — rows arrive ranked worst-first, so data[0] is the day's verdict.
export interface MoiDay {
  date: string;
  rp: number;
  count: number;
  data: MoiUnit[];
}

// One assessable event, scored at a return period. Five exist in the whole
// archive, which is why they are a named ledger and never a rate.
export interface MoiCase {
  event_id: number;
  gid: string;
  region: string;
  iso3: string;
  rp: number;
  verdict: Verdict;
  p_best: number | null;
  p_lead0: number | null;
  best_lead_h: number | null;
  warning_record: string | null;
  span_days: number;
  obs_mm: number | null;
  obs_rp: number | null;
  source: string;
  event_key: string;
  place: string | null;
  start: string;
  end: string;
  deaths: number | null;
  affected: number | null;
}

export interface MoiDayCell {
  verdict: Verdict;
  units: number;
  counts: Record<string, number>;
}

// /xr/moi — only `days` is read here; the rates it also carries belong in the caveats.
export interface MoiYear {
  rp: number;
  year: number | null;
  days: Record<string, MoiDayCell>;
  // Not year-scoped by the backend: the same five cases whatever year is asked for.
  cases: MoiCase[];
}

export interface MoiCoverage {
  iso3: string;
  name: string;
  source_id: string;
  first_day: string;
  last_day: string;
  events: number;
  scorable: number;
  note: string | null;
}

// /xr/moi/info — every parameter the verdict depends on, so the caveats quote the
// build rather than a number typed into the UI and left to drift.
export interface MoiInfo {
  meta: Record<string, string>;
  coverage: MoiCoverage[];
  verdicts: Verdict[];
}

// One short answer per verdict. Deliberately plain: a reader should not need the
// taxonomy, only the sentence under it.
export const VERDICT_LABEL: Record<Verdict, string> = {
  missed_opportunity: 'Missed opportunity',
  late_warning: 'Too late',
  forecast_miss: 'Not anticipated',
  outside_rainfall_model: 'Outside the rainfall model',
  no_recorded_impact: 'No impact recorded',
  no_impact_data: 'Not assessable',
};

// The same verdicts as a clause, for the one-line count of the other regions.
export const VERDICT_PHRASE: Record<Verdict, string> = {
  missed_opportunity: 'with a missed opportunity',
  late_warning: 'warned only on the day',
  forecast_miss: 'not anticipated',
  outside_rainfall_model: 'outside the rainfall model',
  no_recorded_impact: 'with no impact recorded',
  no_impact_data: 'with no loss record reaching them',
};

// What the verdict means *inside MUST* — the context a first-time reader needs
// before the chip can be read at all: what MUST measured, what it did not, and
// which of the two the word is actually about. One per verdict, behind the info
// button, because a reader meets only the one verdict their day carries.
export const VERDICT_MEANING: Record<Verdict, string> = {
  missed_opportunity:
    'Enough of the 51 ensemble members crossed the selected rainfall level at least a day before this flood was recorded. In MUST that is an opportunity: the signal existed early enough to act on. It does not say a warning was issued, or ignored — MUST holds forecasts and recorded losses, never a record of warnings.',
  late_warning:
    'The ensemble crossed the bar, but only on the day the flooding was recorded. MUST counts a signal as actionable only at 24 hours of lead or more, so this one arrived too late to act on even though the forecast was right.',
  forecast_miss:
    'Extreme rainfall was observed and a flood was recorded, yet no run reached the signal bar at any lead MUST can read. This is the case where the forecast, as MUST measures it, did not see the event coming.',
  outside_rainfall_model:
    'A flood was recorded, but no daily rainfall extreme was observed in that region within a day of it. MUST forecasts rainfall exceedance and nothing else, so floods driven by river flow from upstream, dam releases, saturated ground or long ordinary rain fall outside what it can anticipate. This is the largest group in the archive: most recorded floods are of this kind, and they are not forecast failures.',
  no_recorded_impact:
    'Rainfall cleared the extreme level, and this country\u2019s loss register does cover the day, yet nothing was entered against it. That may mean no harm occurred, or that the harm went unrecorded — MUST cannot tell the two apart, so it claims neither.',
  no_impact_data:
    'Rainfall cleared the extreme level in a region no loss register reaches on this day. MUST has impact records for only four countries inside the forecast archive, so nothing follows about consequences here. The day is unscored, not clean.',
};

export const NOTHING_MEANING =
  'No region cleared the 2-year daily rainfall level and no flood was recorded anywhere in the domain, so there is nothing to weigh the forecast against on this day.';

// Three tones, not six colours, and none of them from the exceedance ramp: a
// verdict is a different kind of claim from a probability and must not read as
// a hotter shade of one. `scored` = a flood was recorded and the forecast can be
// judged; `plain` = a stated fact with nothing to judge; `muted` = we cannot say.
export type Tone = 'scored' | 'plain' | 'muted';

export const VERDICT_TONE: Record<Verdict, Tone> = {
  missed_opportunity: 'scored',
  late_warning: 'scored',
  forecast_miss: 'scored',
  outside_rainfall_model: 'plain',
  no_recorded_impact: 'plain',
  no_impact_data: 'muted',
};

const where = (u: MoiUnit) => u.name ?? 'the affected region';

// The verdict spelled out for someone who has never seen a return period. Each
// sentence names the two facts it rests on, so the chip above it is never the
// only thing on screen making the claim.
export function verdictSentence(u: MoiUnit, rp: number): string {
  const lead = u.lead_h ?? 0;
  switch (u.verdict) {
    case 'missed_opportunity':
      return `Flooding was recorded in ${where(u)}, and the ensemble had already flagged ${rp}-year rainfall there ${lead} hours earlier. The chance to act existed.`;
    case 'late_warning':
      return `Flooding was recorded in ${where(u)}, but the rainfall signal only appeared on the day itself — too late to act on.`;
    case 'forecast_miss':
      return `Flooding was recorded in ${where(u)} after extreme rainfall the ensemble never flagged at the ${rp}-year level.`;
    case 'outside_rainfall_model':
      return `Flooding was recorded in ${where(u)}, but rainfall there was ordinary that day. This flood sits outside what MUST forecasts.`;
    case 'no_recorded_impact':
      return `Extreme rainfall fell in ${where(u)}. Nothing was entered in that country's loss register for the day.`;
    case 'no_impact_data':
      return `Extreme rainfall fell in ${where(u)}, where no loss register reaches. Whether it caused harm is unknown.`;
  }
}

// Worst-first, then by what the event cost. Ranking on impact alone would open
// with a three-death case the forecast never saw and bury the one day the
// ensemble actually called early — which is the story the ledger exists to tell.
export function rankCases(cases: MoiCase[]): MoiCase[] {
  const rank: Record<string, number> = {
    missed_opportunity: 0,
    late_warning: 1,
    forecast_miss: 2,
  };
  return [...cases].sort(
    (a, b) =>
      (rank[a.verdict] ?? 9) - (rank[b.verdict] ?? 9) ||
      (b.deaths ?? 0) - (a.deaths ?? 0) ||
      (b.affected ?? 0) - (a.affected ?? 0),
  );
}

const nn = (n: number) => n.toLocaleString('en-US');

// What the event cost, in the words a register can support: a null is an unfiled
// field, never a zero, so it is left unsaid rather than reported as no harm.
export function caseToll(c: MoiCase): string {
  const parts: string[] = [];
  if (c.deaths) parts.push(`${nn(c.deaths)} ${c.deaths === 1 ? 'person died' : 'people died'}`);
  // "people" attaches to whichever clause stands alone, so a card never reads
  // "3,000 were affected" with nothing for the number to count.
  if (c.affected) {
    parts.push(`${nn(c.affected)}${c.deaths ? '' : ' people'} were affected`);
  }
  return parts.join(' and ');
}

// The card's sentence, built from the case rather than written by hand, so a
// curated story can never drift from the row it claims to describe. The toll is
// its own sentence: appended to the rainfall clause it produced a second "and".
export function caseStory(c: MoiCase, rp: number): string {
  const p = (v: number | null) => `${Math.round((v ?? 0) * 100)}%`;
  const fell = c.obs_mm != null ? `${c.obs_mm.toFixed(0)} mm fell` : 'Extreme rain fell';
  const toll = caseToll(c);
  const tail = toll ? ` ${toll}.` : '';
  const peak = Math.max(c.p_best ?? 0, c.p_lead0 ?? 0);
  switch (c.verdict) {
    case 'missed_opportunity':
      return `${p(c.p_best)} of the ensemble already had ${rp}-year rainfall here ${c.best_lead_h} hours out, rising to ${p(c.p_lead0)} on the day. ${fell}.${tail}`;
    case 'late_warning':
      return `Nothing crossed the bar until the day itself, when ${p(c.p_lead0)} of members did — no lead time to act on. ${fell}.${tail}`;
    default:
      return `${fell} — a ${c.obs_rp ?? 2}-year day — with ${
        peak > 0 ? `the ensemble never past ${p(peak)}` : 'no member reaching the bar'
      } at any lead.${tail}`;
  }
}

export const NOTHING_TO_EVALUATE =
  'No extreme rainfall was observed and no flood was recorded anywhere in the region on this day.';
