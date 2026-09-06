/**
 * A straight-up pick is "who wins, and by roughly how much" rather than an
 * exact final score. Entering two numbers for 272 games is far more work
 * than anyone will actually do, and the exact digits never mattered:
 * everything downstream (standings point differentials, the NFL's net-points
 * tiebreaker steps, the bracket) only ever reads the MARGIN between the two
 * scores, never the raw points.
 *
 * The bucket edges are NFL-shaped, not generic. Scoring in threes and sevens
 * makes 3 and 7 the meaningful thresholds -- a field goal, then a touchdown
 * -- so a "close game" bucket that ran 1-7 would lump a last-second field
 * goal in with a comfortable one-score win. The college app's wider buckets
 * would be wrong here.
 */
export type MarginBucketId = 0 | 1 | 2 | 3;

export type MarginBucket = {
  id: MarginBucketId;
  /** Shown on the pick control, e.g. "4-7". */
  label: string;
  /** Plain-language name for the tier. */
  name: string;
  min: number;
  /** Inclusive; Infinity for the open-ended top bucket. */
  max: number;
  /**
   * The margin this bucket stands in for wherever a single number is needed
   * -- roughly the middle of the range, with a sensible blowout figure for
   * the open-ended top bucket rather than a midpoint of Infinity.
   */
  representativeMargin: number;
};

export const MARGIN_BUCKETS: readonly MarginBucket[] = [
  { id: 0, label: "1-3", name: "Field goal", min: 1, max: 3, representativeMargin: 3 },
  { id: 1, label: "4-7", name: "One score", min: 4, max: 7, representativeMargin: 6 },
  { id: 2, label: "8-14", name: "Two scores", min: 8, max: 14, representativeMargin: 11 },
  { id: 3, label: "15+", name: "Comfortable", min: 15, max: Infinity, representativeMargin: 20 },
];

export function isMarginBucketId(value: number): value is MarginBucketId {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

export function marginBucket(id: MarginBucketId): MarginBucket {
  return MARGIN_BUCKETS[id];
}

/** Which bucket a real margin falls into. */
export function bucketForMargin(margin: number): MarginBucketId {
  const m = Math.abs(margin);
  if (m <= 3) return 0;
  if (m <= 7) return 1;
  if (m <= 14) return 2;
  return 3;
}

/**
 * A losing score to hang the representative margin off of, so the rest of
 * the app can keep working in terms of a (home, away) score pair. Only the
 * DIFFERENCE carries meaning -- these are not a claim about a real final
 * score, just a stable way to express "won by about this much". 20 is close
 * to the modern league average for a losing team.
 */
export const NOMINAL_LOSING_SCORE = 20;

/** The (winner, loser) score pair standing in for a bucket. */
export function representativeScores(id: MarginBucketId): {
  winner: number;
  loser: number;
} {
  return {
    winner: NOMINAL_LOSING_SCORE + marginBucket(id).representativeMargin,
    loser: NOMINAL_LOSING_SCORE,
  };
}
