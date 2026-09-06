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
 */

export type PickGrade = "win" | "loss" | "push" | "none";

export const POINTS_STRAIGHT_UP = 1;
export const POINTS_ATS = 1;
/**
 * A push is neither won nor lost. Awarding nothing would penalise someone
 * for the line landing exactly on the margin, which is not a judgement they
 * got wrong.
 */
export const POINTS_ATS_PUSH = 0.5;

/**
 * Did the against-the-spread pick cover? `spread` is the HOME line, so
 * adding it to the home score is the standard settlement: a home favourite
 * at -3.5 must win by more than 3.5 for the adjusted margin to stay
 * positive.
 */
export function gradeAts(
  atsTeamId: number | null,
  spread: number | null,
  homeTeamId: number,
  awayTeamId: number,
  homeScore: number,
  awayScore: number,
): PickGrade {
  if (atsTeamId === null || spread === null) return "none";

  const adjustedMargin = homeScore + spread - awayScore;
  if (adjustedMargin === 0) return "push";

  const homeCovered = adjustedMargin > 0;
  if (atsTeamId === homeTeamId) return homeCovered ? "win" : "loss";
  if (atsTeamId === awayTeamId) return homeCovered ? "loss" : "win";
  return "none";
}

export function gradeStraightUp(
  winnerTeamId: number | null,
  homeTeamId: number,
  awayTeamId: number,
  homeScore: number,
  awayScore: number,
): PickGrade {
  if (winnerTeamId === null) return "none";
  // A real tie means nobody picked the winner, because there wasn't one.
  if (homeScore === awayScore) return "push";
  const actualWinner = homeScore > awayScore ? homeTeamId : awayTeamId;
  return winnerTeamId === actualWinner ? "win" : "loss";
}
