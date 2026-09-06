import { sql } from "./db";
import { POINTS_CORRECT, POINTS_MARGIN, gradeMargin, gradeStraightUp } from "./grade";
import { CURRENT_SEASON, REGULAR_SEASON_TYPE } from "./nfl";
import type { BracketSlot } from "./playoffs";
import {
  derivePostseasonPrediction,
  getPostseasonTruth,
  truthIsEmpty,
} from "./postseason";
import { getSeasonGames, getTeams } from "./queries";
import { scorePostseason, type PostseasonScore } from "./seasonScore";

/**
 * Leaderboard totals.
 *
 * Two points are available on every game: one for the winner, one more if
 * the margin bucket landed as well. That accumulates all season. On top of
 * it sits the postseason bonus (lib/seasonScore.ts), which pays per club of
 * yours that reached each round of the real bracket and doubles every round.
 */

export {
  POINTS_CORRECT,
  POINTS_MARGIN,
  gradeMargin,
  gradeStraightUp,
  type PickGrade,
} from "./grade";

export type LeaderboardRow = {
  userId: number;
  name: string;
  image: string | null;
  gamesGraded: number;
  correct: number;
  wrong: number;
  /** Games that ended in a real tie -- nobody called a winner. */
  ties: number;
  /** Of the games called correctly, how many also landed the margin bucket. */
  margins: number;
  gamePoints: number;
  marginPoints: number;
  postseason: PostseasonScore | null;
  postseasonPoints: number;
  points: number;
  /** Share of decided games called correctly, 0-1. */
  pct: number;
  /** Share of correct calls whose margin also landed, 0-1. */
  marginPct: number;
};

type GradeRow = {
  user_id: number;
  home_team_id: number;
  away_team_id: number;
  home_score: number;
  away_score: number;
  winner_team_id: number;
  margin_bucket: number;
};

/**
 * Grade every finished, picked game for the season -- optionally just one
 * week. Done in application code rather than SQL because these are the same
 * rules the per-game badge shows next to each pick, and two implementations
 * of them would eventually disagree.
 *
 * `week` scopes only the regular-season half. A weekly view of a
 * once-a-season postseason bonus would be meaningless, so it is left out of
 * the filtered board entirely rather than shown against one week.
 */
export async function getLeaderboard(
  season: number = CURRENT_SEASON,
  week?: number,
): Promise<LeaderboardRow[]> {
  const rows = await sql<GradeRow[]>`
    SELECT p.user_id,
           g.home_team_id, g.away_team_id, g.home_score, g.away_score,
           p.winner_team_id, p.margin_bucket
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
        margins: 0,
        gamePoints: 0,
        marginPoints: 0,
        postseason: null,
        postseasonPoints: 0,
        points: 0,
        pct: 0,
        marginPct: 0,
      },
    ]),
  );

  for (const row of rows) {
    const entry = byUser.get(row.user_id);
    if (!entry) continue;

    entry.gamesGraded++;
    const winner = gradeStraightUp(
      row.winner_team_id,
      row.home_team_id,
      row.away_team_id,
      row.home_score,
      row.away_score,
    );
    if (winner === "win") entry.correct++;
    else if (winner === "loss") entry.wrong++;
    else if (winner === "push") entry.ties++;

    if (
      gradeMargin(
        row.winner_team_id,
        row.margin_bucket,
        row.home_team_id,
        row.away_team_id,
        row.home_score,
        row.away_score,
      ) === "win"
    ) {
      entry.margins++;
    }
  }

  // The postseason bonus only exists once some of the real bracket does, so
  // before January this whole branch is skipped -- it would otherwise mean
  // recomputing every user's standings, tiebreakers and seeds on every
  // leaderboard render to award a guaranteed zero.
  const truth = week != null ? null : await getPostseasonTruth(season);
  if (truth && !truthIsEmpty(truth)) {
    const teams = await getTeams();
    for (const entry of byUser.values()) {
      const [games, picks] = await Promise.all([
        getSeasonGames(entry.userId, season),
        getBracketPicksFor(entry.userId, season),
      ]);
      const prediction = derivePostseasonPrediction(teams, games, picks);
      entry.postseason = scorePostseason(prediction, truth);
      entry.postseasonPoints = entry.postseason.total;
    }
  }

  for (const entry of byUser.values()) {
    entry.gamePoints = entry.correct * POINTS_CORRECT;
    entry.marginPoints = entry.margins * POINTS_MARGIN;
    entry.points = entry.gamePoints + entry.marginPoints + entry.postseasonPoints;

    const decided = entry.correct + entry.wrong;
    entry.pct = decided === 0 ? 0 : entry.correct / decided;
    entry.marginPct = entry.correct === 0 ? 0 : entry.margins / entry.correct;
  }

  return [...byUser.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.pct - a.pct ||
      b.marginPct - a.marginPct ||
      a.name.localeCompare(b.name),
  );
}

async function getBracketPicksFor(
  userId: number,
  season: number,
): Promise<Map<BracketSlot, number>> {
  const rows = await sql<{ slot: string; team_id: number }[]>`
    SELECT slot, team_id FROM bracket_picks
    WHERE user_id = ${userId} AND season = ${season}
  `;
  return new Map(rows.map((r) => [r.slot as BracketSlot, r.team_id]));
}

/** Which weeks have graded games, for the leaderboard's week filter. */
export async function getGradedWeeks(
  season: number = CURRENT_SEASON,
): Promise<Set<number>> {
  const rows = await sql<{ week: number }[]>`
    SELECT DISTINCT g.week
    FROM predictions p
    JOIN games g ON g.id = p.game_id
    WHERE g.season = ${season}
      AND g.season_type = ${REGULAR_SEASON_TYPE}
      AND g.status = 'final'
      AND g.home_score IS NOT NULL
      AND g.away_score IS NOT NULL
    ORDER BY g.week
  `;
  return new Set(rows.map((r) => r.week));
}
