import { sql } from "./db";
import { CURRENT_SEASON, REGULAR_SEASON_TYPE, TOTAL_WEEKS } from "./nfl";
import { applyPredictedScores } from "./standings";
import type { BracketSlot } from "./playoffs";
import { downstreamSlots } from "./playoffs";
import type { Game, GameStatus, Team } from "./types";

type TeamRow = {
  id: number;
  espn_id: string;
  abbreviation: string;
  name: string;
  location: string;
  nickname: string;
  conference: "AFC" | "NFC";
  division: "East" | "North" | "South" | "West";
  logo_url: string | null;
  color: string | null;
  alt_color: string | null;
};

function toTeam(row: TeamRow): Team {
  return {
    id: row.id,
    espnId: row.espn_id,
    abbreviation: row.abbreviation,
    name: row.name,
    location: row.location,
    nickname: row.nickname,
    conference: row.conference,
    division: row.division,
    logoUrl: row.logo_url,
    color: row.color,
    altColor: row.alt_color,
  };
}

export async function getTeams(): Promise<Team[]> {
  const rows = await sql<TeamRow[]>`
    SELECT * FROM teams ORDER BY conference, division, name
  `;
  return rows.map(toTeam);
}

type GameRow = {
  id: number;
  espn_id: string | null;
  season: number;
  season_type: number;
  week: number;
  home_team_id: number;
  away_team_id: number;
  is_neutral_site: boolean;
  kickoff_at: Date | null;
  kickoff_tbd: boolean;
  status: GameStatus;
  home_score: number | null;
  away_score: number | null;
  spread: string | null;
  over_under: string | null;
  odds_provider: string | null;
  winner_team_id: number | null;
  margin_bucket: number | null;
  is_default: boolean | null;
};

/**
 * postgres.js returns NUMERIC as a string, deliberately -- it will not
 * silently lose precision by coercing to a float. Spreads are half-point
 * increments, so a Number conversion is safe here and is done in exactly
 * this one place.
 */
function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toGame(row: GameRow): Game {
  return applyPredictedScores({
    id: row.id,
    espnId: row.espn_id,
    season: row.season,
    seasonType: row.season_type,
    week: row.week,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    isNeutralSite: row.is_neutral_site,
    kickoffAt: row.kickoff_at ? row.kickoff_at.toISOString() : null,
    kickoffTbd: row.kickoff_tbd,
    status: row.status,
    homeScore: row.home_score,
    awayScore: row.away_score,
    spread: toNumber(row.spread),
    overUnder: toNumber(row.over_under),
    oddsProvider: row.odds_provider,
    predictedWinnerTeamId: row.winner_team_id,
    predictedMarginBucket: row.margin_bucket,
    isDefault: row.is_default ?? false,
    predictedHomeScore: null,
    predictedAwayScore: null,
  });
}

const GAME_SELECT = sql`
  SELECT g.*, p.winner_team_id, p.margin_bucket, p.is_default
  FROM games g
`;

/** One week's games, with the given user's picks attached. */
export async function getWeekGames(
  userId: number,
  week: number,
  season: number = CURRENT_SEASON,
): Promise<Game[]> {
  const rows = await sql<GameRow[]>`
    ${GAME_SELECT}
    LEFT JOIN predictions p ON p.game_id = g.id AND p.user_id = ${userId}
    WHERE g.season = ${season}
      AND g.season_type = ${REGULAR_SEASON_TYPE}
      AND g.week = ${week}
    ORDER BY g.kickoff_at NULLS LAST, g.id
  `;
  return rows.map(toGame);
}

/** Every regular-season game with the user's picks -- the standings input. */
export async function getSeasonGames(
  userId: number,
  season: number = CURRENT_SEASON,
): Promise<Game[]> {
  const rows = await sql<GameRow[]>`
    ${GAME_SELECT}
    LEFT JOIN predictions p ON p.game_id = g.id AND p.user_id = ${userId}
    WHERE g.season = ${season} AND g.season_type = ${REGULAR_SEASON_TYPE}
    ORDER BY g.week, g.kickoff_at NULLS LAST, g.id
  `;
  return rows.map(toGame);
}

/** The shared schedule with no user attached -- for real standings. */
export async function getSeasonSchedule(
  season: number = CURRENT_SEASON,
): Promise<Game[]> {
  const rows = await sql<GameRow[]>`
    SELECT g.*, NULL::int AS winner_team_id, NULL::smallint AS margin_bucket,
           FALSE AS is_default
    FROM games g
    WHERE g.season = ${season} AND g.season_type = ${REGULAR_SEASON_TYPE}
    ORDER BY g.week, g.kickoff_at NULLS LAST, g.id
  `;
  return rows.map(toGame);
}

/**
 * Whether a game is still open to picks. Kickoff is the lock: once the ball
 * is in the air the line and the result are both partly known, so a pick
 * made after it would not be a prediction.
 *
 * Enforced on the server for every write. The UI also disables locked
 * games, but that is a courtesy -- a form post can arrive at any time.
 */
export function isLocked(game: Game, now: Date = new Date()): boolean {
  if (game.status !== "scheduled") return true;
  if (!game.kickoffAt) return false;
  return new Date(game.kickoffAt).getTime() <= now.getTime();
}

export type PickInput = {
  gameId: number;
  winnerTeamId: number;
  marginBucket: number;
  isDefault?: boolean;
};

/**
 * Save one pick: a winner and roughly how big the margin will be.
 *
 * The kickoff lock is enforced here rather than only in the UI. The page
 * disables a locked game as a courtesy, but a form post can arrive at any
 * time -- from a tab left open since Sunday morning, or by hand -- so the
 * check that actually matters is this one.
 */
export async function savePick(
  userId: number,
  input: PickInput,
  season: number = CURRENT_SEASON,
): Promise<void> {
  const games = await sql<
    { id: number; week: number; status: GameStatus; kickoff_at: Date | null }[]
  >`
    SELECT id, week, status, kickoff_at FROM games WHERE id = ${input.gameId}
  `;
  const game = games[0];
  if (!game) throw new Error("No such game");
  if (
    game.status !== "scheduled" ||
    (game.kickoff_at && game.kickoff_at.getTime() <= Date.now())
  ) {
    throw new Error("That game has already kicked off");
  }

  await sql`
    INSERT INTO predictions (
      user_id, game_id, winner_team_id, margin_bucket, is_default
    )
    VALUES (
      ${userId}, ${input.gameId}, ${input.winnerTeamId},
      ${input.marginBucket}, ${input.isDefault ?? false}
    )
    ON CONFLICT (user_id, game_id) DO UPDATE SET
      winner_team_id = EXCLUDED.winner_team_id,
      margin_bucket  = EXCLUDED.margin_bucket,
      is_default     = EXCLUDED.is_default,
      updated_at     = now()
  `;

  // Editing a pick un-submits its week, so the change cannot leak into the
  // derived standings and bracket until the user submits again.
  await unsubmitWeek(userId, game.week, season);
}

/** Remove the picks the user actually made, leaving auto-filled ones alone. */
export async function clearWeek(
  userId: number,
  week: number,
  season: number = CURRENT_SEASON,
): Promise<number> {
  const deleted = await sql<{ id: number }[]>`
    DELETE FROM predictions p
    USING games g
    WHERE p.game_id = g.id
      AND p.user_id = ${userId}
      AND g.season = ${season}
      AND g.season_type = ${REGULAR_SEASON_TYPE}
      AND g.week = ${week}
      AND g.status = 'scheduled'
      AND (g.kickoff_at IS NULL OR g.kickoff_at > now())
    RETURNING p.id
  `;
  await unsubmitWeek(userId, week, season);
  return deleted.length;
}

export async function getSubmittedWeeks(
  userId: number,
  season: number = CURRENT_SEASON,
): Promise<Set<number>> {
  const rows = await sql<{ week: number }[]>`
    SELECT week FROM week_submissions
    WHERE user_id = ${userId} AND season = ${season}
  `;
  return new Set(rows.map((r) => r.week));
}

export async function submitWeek(
  userId: number,
  week: number,
  season: number = CURRENT_SEASON,
): Promise<void> {
  await sql`
    INSERT INTO week_submissions (user_id, season, week)
    VALUES (${userId}, ${season}, ${week})
    ON CONFLICT (user_id, season, week) DO NOTHING
  `;
}

export async function unsubmitWeek(
  userId: number,
  week: number,
  season: number = CURRENT_SEASON,
): Promise<void> {
  await sql`
    DELETE FROM week_submissions
    WHERE user_id = ${userId} AND season = ${season} AND week = ${week}
  `;
  // The frozen standings were computed from a full, submitted season; one
  // un-submitted week makes them stale, so they go rather than linger past
  // the data they came from.
  await sql`
    DELETE FROM final_standings
    WHERE user_id = ${userId} AND season = ${season}
  `;
}

export async function hasSubmittedFullSeason(
  userId: number,
  season: number = CURRENT_SEASON,
): Promise<boolean> {
  const submitted = await getSubmittedWeeks(userId, season);
  return submitted.size >= TOTAL_WEEKS;
}

// --- bracket -------------------------------------------------------------

export async function getBracketPicks(
  userId: number,
  season: number = CURRENT_SEASON,
): Promise<Map<BracketSlot, number>> {
  const rows = await sql<{ slot: string; team_id: number }[]>`
    SELECT slot, team_id FROM bracket_picks
    WHERE user_id = ${userId} AND season = ${season}
  `;
  return new Map(rows.map((r) => [r.slot as BracketSlot, r.team_id]));
}

/**
 * Save a bracket pick and drop everything downstream of it, so changing an
 * earlier round cannot leave a now-impossible matchup standing in a later
 * one.
 */
export async function saveBracketPick(
  userId: number,
  slot: BracketSlot,
  teamId: number,
  season: number = CURRENT_SEASON,
): Promise<void> {
  await sql`
    INSERT INTO bracket_picks (season, user_id, slot, team_id)
    VALUES (${season}, ${userId}, ${slot}, ${teamId})
    ON CONFLICT (season, user_id, slot) DO UPDATE SET
      team_id = EXCLUDED.team_id, updated_at = now()
  `;
  const stale = downstreamSlots(slot);
  if (stale.length > 0) {
    await sql`
      DELETE FROM bracket_picks
      WHERE user_id = ${userId} AND season = ${season}
        AND slot = ANY(${stale})
    `;
  }
}

export async function clearBracket(
  userId: number,
  season: number = CURRENT_SEASON,
): Promise<void> {
  await sql`
    DELETE FROM bracket_picks WHERE user_id = ${userId} AND season = ${season}
  `;
}

// --- users ---------------------------------------------------------------

export type PoolUser = {
  id: number;
  name: string | null;
  email: string;
  image: string | null;
};

export async function getPoolUsers(): Promise<PoolUser[]> {
  const rows = await sql<PoolUser[]>`
    SELECT id, name, email, image FROM users ORDER BY COALESCE(name, email)
  `;
  return rows;
}

/**
 * The week to land on by default: the earliest week that still has a game
 * ahead of it, falling back to the last week once the season is over.
 */
export async function getCurrentWeek(
  season: number = CURRENT_SEASON,
): Promise<number> {
  const rows = await sql<{ week: number }[]>`
    SELECT MIN(week) AS week FROM games
    WHERE season = ${season}
      AND season_type = ${REGULAR_SEASON_TYPE}
      AND status = 'scheduled'
  `;
  return rows[0]?.week ?? TOTAL_WEEKS;
}
