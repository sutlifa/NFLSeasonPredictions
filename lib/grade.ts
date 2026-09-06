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
 * Only the winner is scored. Point spreads are shown next to a game as
 * context, but nothing is picked or graded against them.
 */

export type PickGrade = "win" | "loss" | "push" | "none";

export const POINTS_CORRECT = 1;

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
