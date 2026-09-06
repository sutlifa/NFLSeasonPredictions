/**
 * The season total: one number per person, built from the two things they
 * were asked to predict.
 *
 *   Regular season -- every winner they called, plus a second point where
 *     the margin bucket landed too. This accumulates week by week.
 *
 *   Postseason -- how much of the real bracket their own bracket matched,
 *     paid per surviving club and doubling every round, so calling a club
 *     that goes all the way is worth far more than calling one that squeaks
 *     into the field and loses in January.
 *
 * All of it is pure: results in, points out, no database.
 */

export const SEASON_POINTS = {
  /** Per game where the winning club was called correctly. */
  correctWinner: 1,
  /**
   * Extra, per correctly-called game whose margin bucket also matched.
   *
   * Only awarded on games whose winner was right. A margin is a claim about
   * how a club wins; getting it "right" while having the wrong club win is a
   * coincidence, not a read.
   */
  correctMargin: 1,
} as const;

/**
 * Postseason bonus, per club of yours that reached each round of the real
 * bracket. Doubling each round, so a club is worth more the further it
 * actually goes -- and every club you had in the Super Bowl has already paid
 * out at all four earlier rounds on its way there.
 *
 * A perfect postseason is 156, and a club you had going all the way is worth
 * 62 on its own (2 + 4 + 8 + 16 + 32).
 *
 * These are the whole tuning surface for how much January matters. The
 * regular season offers 544 points across 272 games at two apiece, so the
 * ladder was doubled from its original 1/2/4/8/16 -- at that size the entire
 * postseason came to 78, and calling the champion outright was worth eight
 * regular-season games, which is less than the gap first and second are
 * likely to open up over eighteen weeks. At this size the bonus can actually
 * decide the title. Change the five numbers and everything downstream --
 * the leaderboard columns, the "perfect bracket is N" copy, the About page
 * -- follows from them.
 */
export const POSTSEASON_POINTS = {
  /** Per club of your 14 that made the real field. */
  field: 2,
  /** Per club of yours that reached the divisional round (8 clubs). */
  divisional: 4,
  /** Per club of yours that reached a conference championship (4 clubs). */
  conference: 8,
  /** Per club of yours that reached the Super Bowl (2 clubs). */
  superBowl: 16,
  /** For calling the Super Bowl champion. */
  champion: 32,
} as const;

/** The rounds a bonus is paid for, in order, with their per-club value. */
export const BONUS_ROUNDS = [
  { key: "field", label: "Made the playoffs", points: POSTSEASON_POINTS.field, clubs: 14 },
  { key: "divisional", label: "Divisional round", points: POSTSEASON_POINTS.divisional, clubs: 8 },
  { key: "conference", label: "Conference championship", points: POSTSEASON_POINTS.conference, clubs: 4 },
  { key: "super_bowl", label: "Super Bowl", points: POSTSEASON_POINTS.superBowl, clubs: 2 },
] as const;

export type BonusRoundKey = (typeof BONUS_ROUNDS)[number]["key"];

/** What one person predicted, reduced to the sets the bonus is scored on. */
export type PostseasonPrediction = {
  /** Their 14 seeded clubs, from their own predicted standings. */
  field: number[];
  /** Clubs their bracket has reaching each round. */
  divisional: number[];
  conference: number[];
  superBowl: number[];
  championTeamId: number | null;
};

/** What actually happened. A round is null until it has been played. */
export type PostseasonTruth = {
  field: number[] | null;
  divisional: number[] | null;
  conference: number[] | null;
  superBowl: number[] | null;
  championTeamId: number | null;
};

export type RoundScore = {
  key: BonusRoundKey;
  label: string;
  /** Clubs of theirs that reached this round in reality. */
  hits: number;
  /** Clubs that could have been hit -- 0 while the round is unplayed. */
  possible: number;
  pointsEach: number;
  points: number;
};

export type PostseasonScore = {
  rounds: RoundScore[];
  championCorrect: boolean;
  championPoints: number;
  total: number;
  /** True once any part of the real bracket is known. */
  scored: boolean;
};

/**
 * Score one person's bracket against the real one.
 *
 * A round with no real result yet contributes nothing and reports `possible`
 * as 0, so an unplayed round reads as "not yet" rather than as a miss --
 * which matters from January onward, when the board is live and half the
 * bracket has happened.
 */
export function scorePostseason(
  prediction: PostseasonPrediction,
  truth: PostseasonTruth,
): PostseasonScore {
  const predictedByRound: Record<BonusRoundKey, number[]> = {
    field: prediction.field,
    divisional: prediction.divisional,
    conference: prediction.conference,
    super_bowl: prediction.superBowl,
  };
  const truthByRound: Record<BonusRoundKey, number[] | null> = {
    field: truth.field,
    divisional: truth.divisional,
    conference: truth.conference,
    super_bowl: truth.superBowl,
  };

  const rounds: RoundScore[] = BONUS_ROUNDS.map((round) => {
    const real = truthByRound[round.key];
    if (!real) {
      return {
        key: round.key,
        label: round.label,
        hits: 0,
        possible: 0,
        pointsEach: round.points,
        points: 0,
      };
    }
    const realSet = new Set(real);
    // De-duplicated on purpose: a malformed bracket that somehow listed a
    // club twice must not be paid twice for it.
    const mine = new Set(predictedByRound[round.key]);
    let hits = 0;
    for (const teamId of mine) if (realSet.has(teamId)) hits++;
    return {
      key: round.key,
      label: round.label,
      hits,
      possible: real.length,
      pointsEach: round.points,
      points: hits * round.points,
    };
  });

  const championCorrect =
    prediction.championTeamId !== null &&
    truth.championTeamId !== null &&
    prediction.championTeamId === truth.championTeamId;
  const championPoints = championCorrect ? POSTSEASON_POINTS.champion : 0;

  const scored =
    rounds.some((r) => r.possible > 0) || truth.championTeamId !== null;

  return {
    rounds,
    championCorrect,
    championPoints,
    total: rounds.reduce((sum, r) => sum + r.points, 0) + championPoints,
    scored,
  };
}

/** The most a perfect postseason is worth, for the "x of y" on the page. */
export function maxPostseasonPoints(): number {
  return (
    BONUS_ROUNDS.reduce((sum, r) => sum + r.points * r.clubs, 0) +
    POSTSEASON_POINTS.champion
  );
}
