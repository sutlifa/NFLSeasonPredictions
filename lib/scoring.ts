import { sql } from "./db";
import { POINTS_CORRECT, POINTS_MARGIN, gradeMargin, gradeStraightUp } from "./grade";
import { CURRENT_SEASON, REGULAR_SEASON_TYPE } from "./nfl";
import {
  derivePostseasonPrediction,
  getPostseasonTruth,
  truthIsEmpty,
} from "./postseason";
import {
  getBracketPicksByUser,
  getPickCounts,
  getPickableGameCount,
  getSeasonGamesByUser,
  getTeams,
} from "./queries";
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

/** One person's Super Bowl, as their own bracket has it. */
export type SuperBowlPick = {
  /** Their conference champions -- null until that side of the bracket is filled in. */
  afcTeamId: number | null;
  nfcTeamId: number | null;
  championTeamId: number | null;
};

export type LeaderboardRow = {
  userId: number;
  name: string;
  image: string | null;
  /** Regular-season picks made, and how many there are to make. */
  picksMade: number;
  picksAvailable: number;
  superBowl: SuperBowlPick;
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
        picksMade: 0,
        picksAvailable: 0,
        superBowl: { afcTeamId: null, nfcTeamId: null, championTeamId: null },
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

  // How much of the slate each person has actually filled in. Shown all
  // season, including before anything has been graded -- in September the
  // only meaningful thing to compare is who has done their picks.
  const [pickCounts, picksAvailable] = await Promise.all([
    getPickCounts(season),
    getPickableGameCount(season),
  ]);
  for (const entry of byUser.values()) {
    entry.picksMade = pickCounts.get(entry.userId) ?? 0;
    entry.picksAvailable = picksAvailable;
  }

  // Each person's Super Bowl is derived rather than read straight out of
  // bracket_picks. A stored pick can be stale -- editing a regular-season
  // game moves the standings, which reseeds the field, which can leave a
  // saved conference-championship pick naming a club that is no longer in
  // that game. buildBracket drops a winner that is not actually in its
  // matchup, so going through it shows what the bracket really says now
  // instead of what it said when the pick was made.
  const truth = week != null ? null : await getPostseasonTruth(season);
  const scoreBonus = truth !== null && !truthIsEmpty(truth);

  if (week == null) {
    const [teams, gamesByUser, bracketByUser] = await Promise.all([
      getTeams(),
      getSeasonGamesByUser(season),
      getBracketPicksByUser(season),
    ]);
    const teamById = new Map(teams.map((t) => [t.id, t]));

    for (const entry of byUser.values()) {
      const games = gamesByUser.get(entry.userId);
      if (!games) continue;
      const prediction = derivePostseasonPrediction(
        teams,
        games,
        bracketByUser.get(entry.userId) ?? new Map(),
      );

      // superBowl lists only the sides that have actually been decided, so
      // it cannot be indexed positionally -- a bracket with just the AFC
      // filled in has one entry, not two. Look each side up by conference.
      const sides: Record<string, number | null> = { AFC: null, NFC: null };
      for (const teamId of prediction.superBowl) {
        const conf = teamById.get(teamId)?.conference;
        if (conf) sides[conf] = teamId;
      }
      entry.superBowl = {
        afcTeamId: sides.AFC,
        nfcTeamId: sides.NFC,
        championTeamId: prediction.championTeamId,
      };

      if (scoreBonus && truth) {
        entry.postseason = scorePostseason(prediction, truth);
        entry.postseasonPoints = entry.postseason.total;
      }
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

  // Anyone with a real result to their name ranks above anyone without.
  // Before the season starts nobody has been graded, so the board would
  // otherwise be an alphabetical list of zeroes -- ordering those by how much
  // of the slate they have filled in makes the preseason page a meaningful
  // "who has done their picks" list instead.
  return [...byUser.values()].sort((a, b) => {
    const aScored = a.gamesGraded > 0;
    const bScored = b.gamesGraded > 0;
    if (aScored !== bScored) return aScored ? -1 : 1;
    if (!aScored) {
      return b.picksMade - a.picksMade || a.name.localeCompare(b.name);
    }
    return (
      b.points - a.points ||
      b.pct - a.pct ||
      b.marginPct - a.marginPct ||
      a.name.localeCompare(b.name)
    );
  });
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
