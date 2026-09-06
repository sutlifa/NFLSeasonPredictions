import { sql } from "./db";
import {
  POINTS_ATS,
  POINTS_ATS_PUSH,
  POINTS_STRAIGHT_UP,
  gradeAts,
  gradeStraightUp,
} from "./grade";
import { CURRENT_SEASON, REGULAR_SEASON_TYPE } from "./nfl";

/**
 * Leaderboard scoring.
 *
 * Every finished game a user picked is worth up to two points: one for the
 * straight-up winner, one for the pick against the spread. A push against
 * the number is worth half -- the bet was neither won nor lost, and awarding
 * it nothing would punish someone for a line landing exactly on the margin,
 * which is not a judgement they got wrong.
 *
 * Graded against `spread_at_pick`, the line frozen when the pick was made,
 * NOT the line stored on the game today. Those differ whenever a line moves
 * after someone picks, and grading against the later number would rescore a
 * decision nobody made.
 */

export {
  POINTS_STRAIGHT_UP,
  POINTS_ATS,
  POINTS_ATS_PUSH,
  gradeAts,
  gradeStraightUp,
  type PickGrade,
} from "./grade";

export type LeaderboardRow = {
  userId: number;
  name: string;
  image: string | null;
  gamesGraded: number;
  suWins: number;
  suLosses: number;
  atsWins: number;
  atsLosses: number;
  atsPushes: number;
  points: number;
  /** Share of graded games picked correctly straight up, 0-1. */
  suPct: number;
  atsPct: number;
};

type GradeRow = {
  user_id: number;
  name: string | null;
  email: string;
  image: string | null;
  home_team_id: number;
  away_team_id: number;
  home_score: number;
  away_score: number;
  winner_team_id: number;
  ats_team_id: number | null;
  spread_at_pick: string | null;
};

/**
 * Grade every finished, picked game for the season -- optionally just one
 * week. Done in application code rather than SQL because the settlement
 * rules (the push, the frozen line) are the same rules the per-game UI shows
 * next to each pick, and having two implementations of them would guarantee
 * they eventually disagree.
 */
export async function getLeaderboard(
  season: number = CURRENT_SEASON,
  week?: number,
): Promise<LeaderboardRow[]> {
  const rows = await sql<GradeRow[]>`
    SELECT u.id AS user_id, u.name, u.email, u.image,
           g.home_team_id, g.away_team_id, g.home_score, g.away_score,
           p.winner_team_id, p.ats_team_id, p.spread_at_pick
    FROM predictions p
    JOIN games g ON g.id = p.game_id
    JOIN users u ON u.id = p.user_id
    WHERE g.season = ${season}
      AND g.season_type = ${REGULAR_SEASON_TYPE}
      AND g.status = 'final'
      AND g.home_score IS NOT NULL
      AND g.away_score IS NOT NULL
      ${week != null ? sql`AND g.week = ${week}` : sql``}
  `;

  const byUser = new Map<number, LeaderboardRow>();
  // Everyone with an account appears, even at 0 -- a leaderboard that hides
  // people until they score reads as a bug to the person who is missing.
  const users = await sql<{ id: number; name: string | null; email: string; image: string | null }[]>`
    SELECT id, name, email, image FROM users
  `;
  for (const user of users) {
    byUser.set(user.id, {
      userId: user.id,
      name: user.name ?? user.email,
      image: user.image,
      gamesGraded: 0,
      suWins: 0,
      suLosses: 0,
      atsWins: 0,
      atsLosses: 0,
      atsPushes: 0,
      points: 0,
      suPct: 0,
      atsPct: 0,
    });
  }

  for (const row of rows) {
    const entry = byUser.get(row.user_id);
    if (!entry) continue;

    entry.gamesGraded++;

    const su = gradeStraightUp(
      row.winner_team_id,
      row.home_team_id,
      row.away_team_id,
      row.home_score,
      row.away_score,
    );
    if (su === "win") {
      entry.suWins++;
      entry.points += POINTS_STRAIGHT_UP;
    } else if (su === "loss") {
      entry.suLosses++;
    }

    const spread = row.spread_at_pick === null ? null : Number(row.spread_at_pick);
    const ats = gradeAts(
      row.ats_team_id,
      spread,
      row.home_team_id,
      row.away_team_id,
      row.home_score,
      row.away_score,
    );
    if (ats === "win") {
      entry.atsWins++;
      entry.points += POINTS_ATS;
    } else if (ats === "loss") {
      entry.atsLosses++;
    } else if (ats === "push") {
      entry.atsPushes++;
      entry.points += POINTS_ATS_PUSH;
    }
  }

  for (const entry of byUser.values()) {
    const suGames = entry.suWins + entry.suLosses;
    const atsGames = entry.atsWins + entry.atsLosses;
    entry.suPct = suGames === 0 ? 0 : entry.suWins / suGames;
    entry.atsPct = atsGames === 0 ? 0 : entry.atsWins / atsGames;
  }

  return [...byUser.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.atsWins - a.atsWins ||
      b.suWins - a.suWins ||
      a.name.localeCompare(b.name),
  );
}

/** Per-week points for one user, for the sparkline on the leaderboard. */
export async function getWeeklyPoints(
  season: number = CURRENT_SEASON,
): Promise<Map<number, Map<number, number>>> {
  const rows = await sql<(GradeRow & { week: number })[]>`
    SELECT u.id AS user_id, u.name, u.email, u.image, g.week,
           g.home_team_id, g.away_team_id, g.home_score, g.away_score,
           p.winner_team_id, p.ats_team_id, p.spread_at_pick
    FROM predictions p
    JOIN games g ON g.id = p.game_id
    JOIN users u ON u.id = p.user_id
    WHERE g.season = ${season}
      AND g.season_type = ${REGULAR_SEASON_TYPE}
      AND g.status = 'final'
      AND g.home_score IS NOT NULL
      AND g.away_score IS NOT NULL
  `;

  const byUser = new Map<number, Map<number, number>>();
  for (const row of rows) {
    const weeks = byUser.get(row.user_id) ?? new Map<number, number>();
    let points = weeks.get(row.week) ?? 0;

    if (
      gradeStraightUp(
        row.winner_team_id,
        row.home_team_id,
        row.away_team_id,
        row.home_score,
        row.away_score,
      ) === "win"
    ) {
      points += POINTS_STRAIGHT_UP;
    }
    const ats = gradeAts(
      row.ats_team_id,
      row.spread_at_pick === null ? null : Number(row.spread_at_pick),
      row.home_team_id,
      row.away_team_id,
      row.home_score,
      row.away_score,
    );
    if (ats === "win") points += POINTS_ATS;
    else if (ats === "push") points += POINTS_ATS_PUSH;

    weeks.set(row.week, points);
    byUser.set(row.user_id, weeks);
  }
  return byUser;
}
