/**
 * League shape constants. These are structural facts about the NFL, not
 * data to be fetched -- eight divisions of four, an 18-week regular season,
 * and a 14-team postseason have all been stable since 2021 and are what the
 * standings, tiebreaker and bracket code is written against.
 */

export const CURRENT_SEASON = Number(process.env.NFL_SEASON ?? 2026);

/** ESPN's seasontype for the regular season. Preseason is 1, postseason 3. */
export const REGULAR_SEASON_TYPE = 2;

/**
 * 18 weeks since 2021 (17 games + one bye per club). Every club has exactly
 * one bye somewhere in weeks 5-14, so a given week holds 13-16 games rather
 * than a fixed number -- nothing here may assume a constant game count.
 */
export const TOTAL_WEEKS = 18;

export const WEEKS: readonly number[] = Array.from(
  { length: TOTAL_WEEKS },
  (_, i) => i + 1,
);

export function isValidWeek(week: number): boolean {
  return Number.isInteger(week) && week >= 1 && week <= TOTAL_WEEKS;
}

export type Conference = "AFC" | "NFC";
export type DivisionName = "East" | "North" | "South" | "West";

export const CONFERENCES: readonly Conference[] = ["AFC", "NFC"];
export const DIVISION_NAMES: readonly DivisionName[] = [
  "East",
  "North",
  "South",
  "West",
];

/** 'AFC East' -- the key used by final_standings and every grouped view. */
export type DivisionKey = `${Conference} ${DivisionName}`;

export const DIVISIONS: readonly DivisionKey[] = CONFERENCES.flatMap((conf) =>
  DIVISION_NAMES.map((div) => `${conf} ${div}` as DivisionKey),
);

export function divisionKey(
  conference: Conference,
  division: DivisionName,
): DivisionKey {
  return `${conference} ${division}`;
}

/**
 * Seven playoff berths per conference: the four division winners (seeded
 * 1-4 by record) plus three wild cards (seeded 5-7). Only the top seed gets
 * a bye -- that has been the format since the field expanded in 2020.
 */
export const PLAYOFF_TEAMS_PER_CONFERENCE = 7;
export const DIVISION_WINNERS_PER_CONFERENCE = 4;
export const WILD_CARDS_PER_CONFERENCE = 3;

/**
 * ESPN's division group ids, as returned by
 * `.../seasons/{year}/types/2/groups/{8|7}/children`. They are NOT in any
 * readable order (AFC East is 4, AFC North is 12), so this table was read
 * off the live API rather than inferred -- do not "tidy" it into sequence.
 *
 * Each team on the teams endpoint carries `groups.id` (its division) and
 * `groups.parent.id` (its conference), which is how a club's alignment is
 * resolved at seed time instead of being hardcoded per club: teams have
 * relocated and divisions have been redrawn before. scripts/seed-teams.ts
 * cross-checks every id here against the API's own group names and fails
 * loudly on a mismatch, so a future realignment surfaces as an error rather
 * than as 32 silently misfiled teams.
 */
export const ESPN_CONFERENCE_GROUP_IDS: Record<string, Conference> = {
  "8": "AFC",
  "7": "NFC",
};

export const ESPN_DIVISION_GROUP_IDS: Record<string, DivisionKey> = {
  "4": "AFC East",
  "12": "AFC North",
  "13": "AFC South",
  "6": "AFC West",
  "1": "NFC East",
  "10": "NFC North",
  "11": "NFC South",
  "3": "NFC West",
};
