import type { Conference, DivisionKey, DivisionName } from "./nfl";

export type Team = {
  id: number;
  espnId: string;
  abbreviation: string;
  /** Full display name, e.g. "Buffalo Bills". */
  name: string;
  /** "Buffalo" -- used where the full name is too long for the column. */
  location: string;
  /** "Bills". */
  nickname: string;
  conference: Conference;
  division: DivisionName;
  logoUrl: string | null;
  color: string | null;
  altColor: string | null;
};

export function divisionOf(team: Team): DivisionKey {
  return `${team.conference} ${team.division}`;
}

export type GameStatus = "scheduled" | "in_progress" | "final";

/**
 * A scheduled game plus, when the signed-in user has made one, their pick.
 * Home/away is carried explicitly rather than as an ordered pair because
 * the spread is quoted from the home side and standings tiebreakers care
 * which club actually hosted.
 */
export type Game = {
  id: number;
  espnId: string | null;
  season: number;
  seasonType: number;
  week: number;
  homeTeamId: number;
  awayTeamId: number;
  isNeutralSite: boolean;
  kickoffAt: string | null;
  kickoffTbd: boolean;
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
  /**
   * The HOME team's line: -3.5 means the home side is favoured by 3.5.
   * Null until a book posts one (ESPN publishes lines a few days out).
   */
  spread: number | null;
  overUnder: number | null;
  oddsProvider: string | null;

  /** The user's straight-up pick, if any. */
  predictedWinnerTeamId: number | null;
  predictedMarginBucket: number | null;
  /** The user's against-the-spread pick, and the line it was made against. */
  atsTeamId: number | null;
  spreadAtPick: number | null;
  isDefault: boolean;

  /**
   * DERIVED from the straight-up pick above (lib/margin.ts), not stored and
   * not a claim about a real final score -- only the difference between the
   * two carries meaning. Standings, tiebreakers and the bracket all work off
   * this pair, which is why swapping exact scores for margin buckets never
   * required rewriting any of that logic.
   */
  predictedHomeScore: number | null;
  predictedAwayScore: number | null;
};

export type DecidedGame = Game & {
  predictedHomeScore: number;
  predictedAwayScore: number;
};

export function isDecided(game: Game): game is DecidedGame {
  return game.predictedHomeScore !== null && game.predictedAwayScore !== null;
}

/** A game with a real, finished result -- what the leaderboard grades against. */
export function isFinal(
  game: Game,
): game is Game & { homeScore: number; awayScore: number } {
  return (
    game.status === "final" && game.homeScore !== null && game.awayScore !== null
  );
}

/**
 * A club's record. Ties are real in the NFL (roughly one a season) and are
 * counted as half a win in win percentage, which is what every tiebreaker
 * step compares -- so they cannot be dropped the way the college app drops
 * them.
 *
 * Named WLT rather than the obvious `Record` so it cannot shadow
 * TypeScript's built-in `Record<K, V>` in any file that imports it.
 */
export type WLT = {
  wins: number;
  losses: number;
  ties: number;
};

export type StandingsRow = {
  teamId: number;
  team: string;
  conf: Conference;
  div: DivisionName;
  /** Records in all games, in-division games, and in-conference games. */
  overall: WLT;
  divisionRecord: WLT;
  conferenceRecord: WLT;
  pointsFor: number;
  pointsAgainst: number;
  /** Set once a tiebreaker has actually been applied, for the UI footnote. */
  tiebreakerNote?: string;
};

export function winPct(record: WLT): number {
  const games = record.wins + record.losses + record.ties;
  if (games === 0) return 0;
  return (record.wins + record.ties * 0.5) / games;
}

export function formatRecord(record: WLT): string {
  return record.ties > 0
    ? `${record.wins}-${record.losses}-${record.ties}`
    : `${record.wins}-${record.losses}`;
}

export function emptyRecord(): WLT {
  return { wins: 0, losses: 0, ties: 0 };
}
