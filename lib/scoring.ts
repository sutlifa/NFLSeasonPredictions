import { sql } from "./db";
import { POINTS_CORRECT, gradeStraightUp } from "./grade";
import { CURRENT_SEASON, REGULAR_SEASON_TYPE } from "./nfl";

/**
 * Leaderboard scoring: one point per game whose winner you called.
 *
 * The margin attached to a pick is not scored. It exists so the predicted
 * season has point differentials, which the league's tiebreaking procedure
 * needs from "net points in common games" onward -- so it does real work,
 * just not here.
 */

export { POINTS_CORRECT, gradeStraightUp, type PickGrade } from "./grade";

export type LeaderboardRow = {
  userId: number;
  name: string;
  image: string | null;
  gamesGraded: number;
  correct: number;
  wrong: number;
  /** Games that ended in a real tie -- nobody called a winner. */
  ties: number;
  points: number;
  /** Share of decided games called correctly, 0-1. */
  pct: number;
};

type GradeRow = {
  user_id: number;
  home_team_id: number;
  away_team_id: number;
  home_score: number;
  away_score: number;
  winner_team_id: number;
};

/**
 * Grade every finished, picked game for the season -- optionally just one
 * week. Done in application code rather than SQL because these are the same
 * rules the per-game badge shows next to each pick, and two implementations
 * of them would eventually disagree.
 */
export async function getLeaderboard(
  season: number = CURRENT_SEASON,
  week?: number,
): Promise<LeaderboardRow[]> {
  const rows = await sql<GradeRow[]>`
    SELECT p.user_id,
           g.home_team_id, g.away_team_id, g.home_score, g.away_score,
           p.winner_team_id
    FROM predictions p
    JOIN games g ON g.id = p.game_id
    WHERE g.season = ${season}
      AND g.season_type = ${REGULAR_SEASON_TYPE}
      AND g.status = 'final'
      AND g.home_score IS NOT NULL
      AND g.away_score IS NOT NULL
      ${week != null ? sql`AND g.week = ${week}` : sql``}
  `;

  // Everyone with an account appears, even at 0 -- a leaderboard that hides
  // people until they score reads as a bug to the person who is missing.
  const users = await sql<
    { id: number; name: string | null; email: string; image: string | null }[]
  >`SELECT id, name, email, image FROM users`;

  const byUser = new Map<number, LeaderboardRow>(
    users.map((user) => [
      user.id,
      {
        userId: user.id,
        name: user.name ?? user.email,
        image: user.image,
        gamesGraded: 0,
        correct: 0,
        wrong: 0,
        ties: 0,
        points: 0,
        pct: 0,
      },
    ]),
  );

  for (const row of rows) {
    const entry = byUser.get(row.user_id);
    if (!entry) continue;

    entry.gamesGraded++;
    const grade = gradeStraightUp(
      row.winner_team_id,
      row.home_team_id,
      row.away_team_id,
      row.home_score,
      row.away_score,
    );
    if (grade === "win") {
      entry.correct++;
      entry.points += POINTS_CORRECT;
    } else if (grade === "loss") {
      entry.wrong++;
    } else if (grade === "push") {
      entry.ties++;
    }
  }

  for (const entry of byUser.values()) {
    const decided = entry.correct + entry.wrong;
    entry.pct = decided === 0 ? 0 : entry.correct / decided;
  }

  return [...byUser.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.pct - a.pct ||
      a.name.localeCompare(b.name),
  );
}

/** Per-week points per user, used to work out which weeks have been graded. */
export async function getWeeklyPoints(
  season: number = CURRENT_SEASON,
): Promise<Map<number, Map<number, number>>> {
  const rows = await sql<(GradeRow & { week: number })[]>`
    SELECT p.user_id, g.week,
           g.home_team_id, g.away_team_id, g.home_score, g.away_score,
           p.winner_team_id
    FROM predictions p
    JOIN games g ON g.id = p.game_id
    WHERE g.season = ${season}
      AND g.season_type = ${REGULAR_SEASON_TYPE}
      AND g.status = 'final'
      AND g.home_score IS NOT NULL
      AND g.away_score IS NOT NULL
  `;

  const byUser = new Map<number, Map<number, number>>();
  for (const row of rows) {
    const weeks = byUser.get(row.user_id) ?? new Map<number, number>();
    const grade = gradeStraightUp(
      row.winner_team_id,
      row.home_team_id,
      row.away_team_id,
      row.home_score,
      row.away_score,
    );
    // Every graded game sets a key, even a wrong one -- the leaderboard uses
    // the presence of a week here to decide which weeks are worth offering
    // as a filter, and a week where everybody was wrong is still played.
    weeks.set(row.week, (weeks.get(row.week) ?? 0) + (grade === "win" ? POINTS_CORRECT : 0));
    byUser.set(row.user_id, weeks);
  }
  return byUser;
}
