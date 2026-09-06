import { bucketForMargin } from "./margin";

/**
 * How a single pick settles. Pure functions, no database import -- which is
 * the point of the file: the pick UI is a client component and needs these
 * same rules, and importing them from lib/scoring.ts dragged the Postgres
 * driver into the browser bundle.
 *
 * There is exactly one implementation of these rules, used by both the
 * per-game badge and the leaderboard total. Two implementations would
 * eventually disagree, and a row that contradicts the total it feeds is
 * worse than either being wrong on its own.
 *
 * A pick scores twice: once for the winner, and again if the margin bucket
 * landed too. Point spreads are shown next to a game as context, but nothing
 * is picked or graded against them.
 */

export type PickGrade = "win" | "loss" | "push" | "none";

export const POINTS_CORRECT = 1;
export const POINTS_MARGIN = 1;

export function gradeStraightUp(
  winnerTeamId: number | null,
  homeTeamId: number,
  awayTeamId: number,
  homeScore: number,
  awayScore: number,
): PickGrade {
  if (winnerTeamId === null) return "none";
  // A real tie means nobody picked the winner, because there wasn't one.
  // Roughly one game a season ends this way, so it cannot just be ignored.
  if (homeScore === awayScore) return "push";
  const actualWinner = homeScore > awayScore ? homeTeamId : awayTeamId;
  return winnerTeamId === actualWinner ? "win" : "loss";
}

/**
 * Did the margin bucket land as well?
 *
 * Only ever graded on a game whose winner was called correctly. A margin is
 * a claim about HOW a club wins; matching the bucket while having the wrong
 * club win is a coincidence rather than a read, and paying for it would let
 * someone bank points on games they got backwards.
 *
 * Returns "none" when there was no pick, when the winner was wrong, or when
 * the game was tied -- in none of those cases is there a margin to be right
 * about.
 */
export function gradeMargin(
  winnerTeamId: number | null,
  marginBucket: number | null,
  homeTeamId: number,
  awayTeamId: number,
  homeScore: number,
  awayScore: number,
): PickGrade {
  if (winnerTeamId === null || marginBucket === null) return "none";
  if (
    gradeStraightUp(winnerTeamId, homeTeamId, awayTeamId, homeScore, awayScore) !==
    "win"
  ) {
    return "none";
  }
  return marginBucket === bucketForMargin(homeScore - awayScore)
    ? "win"
    : "loss";
}
