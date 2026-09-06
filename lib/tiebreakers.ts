import type { Result } from "./standings";
import {
  emptyRecord,
  winPct,
  type StandingsRow,
  type Team,
  type WLT,
} from "./types";

/**
 * The NFL's published tiebreaking procedure, implemented as written.
 *
 * Two things about the real rules drive the shape of this file, and both are
 * easy to get wrong:
 *
 * 1. IT RESTARTS. The procedure is not a sort with a list of comparators. If
 *    a step separates a group of three into one club and two clubs, the two
 *    that remain tied go back to STEP ONE of the applicable format -- they
 *    do not carry on to step two. A comparator chain would instead keep
 *    walking down the list, and would produce a different (wrong) order in
 *    exactly the cases tiebreakers exist for.
 *
 * 2. THE FORMAT CHANGES WITH THE GROUP SIZE. Two clubs use head-to-head
 *    directly; three or more use "best win percentage in games among the
 *    clubs", and in the conference format head-to-head only counts as a
 *    sweep -- one club having beaten all the others, or lost to all of
 *    them. So a group of three that reduces to two must switch formats as
 *    well as restart.
 *
 * `applyOrder` below implements both: it picks the step list by group size,
 * finds the first step that splits the group, and recurses from the top on
 * each side of the split.
 *
 * Two steps of the published procedure are not implemented, and both are
 * documented at their position in the list rather than silently dropped:
 * "best net touchdowns in all games" (this app stores a margin bucket, not a
 * box score, so touchdowns do not exist) and the final coin toss (replaced
 * by a deterministic order, since a page that reshuffled on every render
 * would be worse than an arbitrary but stable one).
 */

export type TiebreakContext = {
  teamById: Map<number, Team>;
  rowById: Map<number, StandingsRow>;
  /** Every decided game, for head-to-head, common games and net points. */
  results: Result[];
  /** Opponent ids faced, per club -- built once, read by several steps. */
  opponentsByTeam: Map<number, number[]>;
  /** All results a club appears in, for per-club scans. */
  resultsByTeam: Map<number, Result[]>;
  /** Rank of points scored / allowed, within conference and league-wide. */
  pointsRanks: PointsRanks;
};

type PointsRanks = {
  conferenceScored: Map<number, number>;
  conferenceAllowed: Map<number, number>;
  leagueScored: Map<number, number>;
  leagueAllowed: Map<number, number>;
};

/**
 * Rank by a value, best first, with ties sharing the better rank -- which is
 * how the NFL's "combined ranking in points scored and points allowed" step
 * treats clubs on equal points.
 */
function rankBy(
  rows: StandingsRow[],
  value: (row: StandingsRow) => number,
  bestIsHighest: boolean,
): Map<number, number> {
  const sorted = [...rows].sort((a, b) =>
    bestIsHighest ? value(b) - value(a) : value(a) - value(b),
  );
  const ranks = new Map<number, number>();
  let lastValue: number | null = null;
  let lastRank = 0;
  sorted.forEach((row, index) => {
    const v = value(row);
    if (lastValue === null || v !== lastValue) {
      lastRank = index + 1;
      lastValue = v;
    }
    ranks.set(row.teamId, lastRank);
  });
  return ranks;
}

export function buildContext(
  teams: Team[],
  rows: StandingsRow[],
  results: Result[],
): TiebreakContext {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const rowById = new Map(rows.map((r) => [r.teamId, r]));

  const opponentsByTeam = new Map<number, number[]>();
  const resultsByTeam = new Map<number, Result[]>();
  for (const team of teams) {
    opponentsByTeam.set(team.id, []);
    resultsByTeam.set(team.id, []);
  }
  for (const result of results) {
    opponentsByTeam.get(result.homeTeamId)?.push(result.awayTeamId);
    opponentsByTeam.get(result.awayTeamId)?.push(result.homeTeamId);
    resultsByTeam.get(result.homeTeamId)?.push(result);
    resultsByTeam.get(result.awayTeamId)?.push(result);
  }

  const afc = rows.filter((r) => r.conf === "AFC");
  const nfc = rows.filter((r) => r.conf === "NFC");
  const conferenceScored = new Map<number, number>();
  const conferenceAllowed = new Map<number, number>();
  for (const group of [afc, nfc]) {
    for (const [id, rank] of rankBy(group, (r) => r.pointsFor, true)) {
      conferenceScored.set(id, rank);
    }
    // Fewest points allowed is best, hence bestIsHighest = false.
    for (const [id, rank] of rankBy(group, (r) => r.pointsAgainst, false)) {
      conferenceAllowed.set(id, rank);
    }
  }

  return {
    teamById,
    rowById,
    results,
    opponentsByTeam,
    resultsByTeam,
    pointsRanks: {
      conferenceScored,
      conferenceAllowed,
      leagueScored: rankBy(rows, (r) => r.pointsFor, true),
      leagueAllowed: rankBy(rows, (r) => r.pointsAgainst, false),
    },
  };
}

// --- primitives the steps are built from ---------------------------------

/** A club's W-L-T in the subset of its games matching `keep`. */
function recordWhere(
  teamId: number,
  ctx: TiebreakContext,
  keep: (result: Result, opponentId: number) => boolean,
): WLT {
  const record = emptyRecord();
  for (const result of ctx.resultsByTeam.get(teamId) ?? []) {
    const isHome = result.homeTeamId === teamId;
    const opponentId = isHome ? result.awayTeamId : result.homeTeamId;
    if (!keep(result, opponentId)) continue;
    const own = isHome ? result.homeScore : result.awayScore;
    const other = isHome ? result.awayScore : result.homeScore;
    if (own > other) record.wins++;
    else if (own < other) record.losses++;
    else record.ties++;
  }
  return record;
}

/** Net points in the subset of a club's games matching `keep`. */
function netPointsWhere(
  teamId: number,
  ctx: TiebreakContext,
  keep: (result: Result, opponentId: number) => boolean,
): number {
  let net = 0;
  for (const result of ctx.resultsByTeam.get(teamId) ?? []) {
    const isHome = result.homeTeamId === teamId;
    const opponentId = isHome ? result.awayTeamId : result.homeTeamId;
    if (!keep(result, opponentId)) continue;
    net += isHome
      ? result.homeScore - result.awayScore
      : result.awayScore - result.homeScore;
  }
  return net;
}

/** Opponents every club in the group has faced -- the "common games" set. */
function commonOpponents(group: number[], ctx: TiebreakContext): Set<number> {
  const sets = group.map(
    (id) => new Set((ctx.opponentsByTeam.get(id) ?? []).filter((o) => !group.includes(o))),
  );
  if (sets.length === 0) return new Set();
  let common = sets[0];
  for (const set of sets.slice(1)) {
    common = new Set([...common].filter((id) => set.has(id)));
  }
  return common;
}

/**
 * Combined win percentage of the opponents a club beat (strength of victory)
 * or of every opponent it played (strength of schedule). The NFL states both
 * as a combined W-L-T of those opponents; a tie counts once for each time it
 * was played, so a club met twice is counted twice.
 */
function strength(
  teamId: number,
  ctx: TiebreakContext,
  victoriesOnly: boolean,
): number {
  const combined = emptyRecord();
  for (const result of ctx.resultsByTeam.get(teamId) ?? []) {
    const isHome = result.homeTeamId === teamId;
    const own = isHome ? result.homeScore : result.awayScore;
    const other = isHome ? result.awayScore : result.homeScore;
    if (victoriesOnly && own <= other) continue;
    const opponentId = isHome ? result.awayTeamId : result.homeTeamId;
    const opponentRow = ctx.rowById.get(opponentId);
    if (!opponentRow) continue;
    combined.wins += opponentRow.overall.wins;
    combined.losses += opponentRow.overall.losses;
    combined.ties += opponentRow.overall.ties;
  }
  return winPct(combined);
}

// --- steps ---------------------------------------------------------------

/**
 * A step returns a score per club, higher being better, or null when the
 * step does not apply to this group at all (e.g. common games below the
 * four-game minimum, or a conference head-to-head that is not a sweep).
 */
type Step = {
  name: string;
  score: (group: number[], ctx: TiebreakContext) => Map<number, number> | null;
};

function scoreEach(
  group: number[],
  fn: (teamId: number) => number,
): Map<number, number> {
  return new Map(group.map((id) => [id, fn(id)]));
}

const headToHeadAmong: Step = {
  name: "Head-to-head",
  score: (group, ctx) =>
    scoreEach(group, (id) =>
      winPct(recordWhere(id, ctx, (_r, opp) => group.includes(opp))),
    ),
};

/**
 * The conference format's head-to-head, which is NOT the same step. It only
 * applies as a SWEEP: it counts only if one club has beaten each of the
 * others, or lost to each of them. A 1-1 split among three clubs decides
 * nothing and the step is skipped entirely.
 */
const headToHeadSweep: Step = {
  name: "Head-to-head sweep",
  score: (group, ctx) => {
    if (group.length === 2) {
      const scores = scoreEach(group, (id) =>
        winPct(recordWhere(id, ctx, (_r, opp) => group.includes(opp))),
      );
      // Clubs that never met are not separated by this step.
      const played = recordWhere(group[0], ctx, (_r, opp) => opp === group[1]);
      if (played.wins + played.losses + played.ties === 0) return null;
      return scores;
    }
    const others = (id: number) => group.filter((g) => g !== id);
    for (const id of group) {
      const record = recordWhere(id, ctx, (_r, opp) => group.includes(opp));
      const met = new Set(
        (ctx.resultsByTeam.get(id) ?? [])
          .map((r) => (r.homeTeamId === id ? r.awayTeamId : r.homeTeamId))
          .filter((o) => group.includes(o)),
      );
      // A sweep requires having actually played every other club in the group.
      if (met.size !== others(id).length) continue;
      if (record.losses === 0 && record.ties === 0 && record.wins > 0) {
        // Swept everyone: this club alone is promoted.
        return new Map(group.map((g) => [g, g === id ? 1 : 0]));
      }
      if (record.wins === 0 && record.ties === 0 && record.losses > 0) {
        // Swept by everyone: this club alone is dropped.
        return new Map(group.map((g) => [g, g === id ? 0 : 1]));
      }
    }
    return null;
  },
};

const divisionRecord: Step = {
  name: "Division record",
  score: (group, ctx) =>
    scoreEach(group, (id) => {
      const team = ctx.teamById.get(id);
      if (!team) return 0;
      return winPct(
        recordWhere(id, ctx, (_r, opp) => {
          const other = ctx.teamById.get(opp);
          return (
            !!other &&
            other.conference === team.conference &&
            other.division === team.division
          );
        }),
      );
    }),
};

const conferenceRecord: Step = {
  name: "Conference record",
  score: (group, ctx) =>
    scoreEach(group, (id) => {
      const team = ctx.teamById.get(id);
      if (!team) return 0;
      return winPct(
        recordWhere(
          id,
          ctx,
          (_r, opp) => ctx.teamById.get(opp)?.conference === team.conference,
        ),
      );
    }),
};

/**
 * `minimumGames` is the conference format's four-common-game threshold. The
 * division format has no minimum -- clubs in the same division share almost
 * their whole schedule, so there is always a meaningful common set.
 */
function commonGamesRecord(minimumGames: number): Step {
  return {
    name: "Common games",
    score: (group, ctx) => {
      const common = commonOpponents(group, ctx);
      if (common.size === 0) return null;
      if (minimumGames > 0) {
        const counts = group.map(
          (id) =>
            (ctx.resultsByTeam.get(id) ?? []).filter((r) => {
              const opp = r.homeTeamId === id ? r.awayTeamId : r.homeTeamId;
              return common.has(opp);
            }).length,
        );
        if (Math.min(...counts) < minimumGames) return null;
      }
      return scoreEach(group, (id) =>
        winPct(recordWhere(id, ctx, (_r, opp) => common.has(opp))),
      );
    },
  };
}

const strengthOfVictory: Step = {
  name: "Strength of victory",
  score: (group, ctx) => scoreEach(group, (id) => strength(id, ctx, true)),
};

const strengthOfSchedule: Step = {
  name: "Strength of schedule",
  score: (group, ctx) => scoreEach(group, (id) => strength(id, ctx, false)),
};

/** Lower combined rank is better, so it is negated into a higher-is-better score. */
function combinedPointsRank(scope: "conference" | "league"): Step {
  return {
    name:
      scope === "conference"
        ? "Combined points ranking (conference)"
        : "Combined points ranking (league)",
    score: (group, ctx) =>
      scoreEach(group, (id) => {
        const { pointsRanks } = ctx;
        const scored =
          scope === "conference"
            ? pointsRanks.conferenceScored.get(id)
            : pointsRanks.leagueScored.get(id);
        const allowed =
          scope === "conference"
            ? pointsRanks.conferenceAllowed.get(id)
            : pointsRanks.leagueAllowed.get(id);
        return -((scored ?? 99) + (allowed ?? 99));
      }),
  };
}

const netPointsCommon: Step = {
  name: "Net points in common games",
  score: (group, ctx) => {
    const common = commonOpponents(group, ctx);
    if (common.size === 0) return null;
    return scoreEach(group, (id) =>
      netPointsWhere(id, ctx, (_r, opp) => common.has(opp)),
    );
  },
};

const netPointsConference: Step = {
  name: "Net points in conference games",
  score: (group, ctx) =>
    scoreEach(group, (id) => {
      const team = ctx.teamById.get(id);
      if (!team) return 0;
      return netPointsWhere(
        id,
        ctx,
        (_r, opp) => ctx.teamById.get(opp)?.conference === team.conference,
      );
    }),
};

const netPointsAll: Step = {
  name: "Net points in all games",
  score: (group, ctx) => scoreEach(group, (id) => netPointsWhere(id, ctx, () => true)),
};

/**
 * Division format, in the league's published order. Steps 1-2 differ by
 * group size (head-to-head vs. best record among the clubs); everything from
 * "common games" down is shared.
 *
 * Step 11 of the real procedure, "best net touchdowns in all games", cannot
 * be computed here: a pick records a margin bucket, not a box score, so
 * there are no touchdowns to count. Anything still tied at that point falls
 * through to the deterministic order that stands in for the coin toss.
 */
const DIVISION_STEPS: Step[] = [
  headToHeadAmong,
  divisionRecord,
  commonGamesRecord(0),
  conferenceRecord,
  strengthOfVictory,
  strengthOfSchedule,
  combinedPointsRank("conference"),
  combinedPointsRank("league"),
  netPointsCommon,
  netPointsAll,
];

/**
 * Conference (wild card) format. Note what is NOT here: division record,
 * which is meaningless between clubs from different divisions. Head-to-head
 * is the sweep-only variant, and common games carries the four-game minimum.
 */
const CONFERENCE_STEPS: Step[] = [
  headToHeadSweep,
  conferenceRecord,
  commonGamesRecord(4),
  strengthOfVictory,
  strengthOfSchedule,
  combinedPointsRank("conference"),
  combinedPointsRank("league"),
  netPointsConference,
  netPointsAll,
];

/**
 * Stands in for the league's coin toss. A real toss is not reproducible, and
 * a page that reordered itself on every render would be worse than an
 * arbitrary but stable rule -- so ties this deep are settled by team name.
 */
function deterministicOrder(group: number[], ctx: TiebreakContext): number[] {
  return [...group].sort((a, b) => {
    const nameA = ctx.rowById.get(a)?.team ?? String(a);
    const nameB = ctx.rowById.get(b)?.team ?? String(b);
    return nameA.localeCompare(nameB);
  });
}

export type TiebreakTrace = Map<number, string>;

/**
 * Order a group of clubs that are level on record.
 *
 * Applies the first step that separates anyone, then RESTARTS the whole
 * procedure independently on each side of the split -- which is what the
 * published rules require and what a plain comparator chain gets wrong.
 */
function applyOrder(
  group: number[],
  ctx: TiebreakContext,
  scope: "division" | "conference",
  trace: TiebreakTrace,
): number[] {
  if (group.length <= 1) return group;

  const steps = scope === "division" ? DIVISION_STEPS : CONFERENCE_STEPS;

  for (const step of steps) {
    const scores = step.score(group, ctx);
    if (!scores) continue;

    const distinct = new Set(scores.values());
    if (distinct.size <= 1) continue;

    const ordered = [...distinct].sort((a, b) => b - a);
    const best = group.filter((id) => scores.get(id) === ordered[0]);
    const rest = group.filter((id) => scores.get(id) !== ordered[0]);

    for (const id of best) {
      if (!trace.has(id)) trace.set(id, step.name);
    }

    return [
      ...applyOrder(best, ctx, scope, trace),
      ...applyOrder(rest, ctx, scope, trace),
    ];
  }

  for (const id of group) {
    if (!trace.has(id)) trace.set(id, "Coin toss (name order)");
  }
  return deterministicOrder(group, ctx);
}

/**
 * Sort clubs by record first, then resolve every group that is level using
 * the appropriate tiebreaking format.
 */
export function rankTeams(
  teamIds: number[],
  ctx: TiebreakContext,
  scope: "division" | "conference",
): { order: number[]; trace: TiebreakTrace } {
  const trace: TiebreakTrace = new Map();
  const byRecord = [...teamIds].sort((a, b) => {
    const rowA = ctx.rowById.get(a);
    const rowB = ctx.rowById.get(b);
    return winPct(rowB?.overall ?? emptyRecord()) - winPct(rowA?.overall ?? emptyRecord());
  });

  const order: number[] = [];
  let index = 0;
  while (index < byRecord.length) {
    const pct = winPct(ctx.rowById.get(byRecord[index])?.overall ?? emptyRecord());
    let end = index;
    while (
      end < byRecord.length &&
      winPct(ctx.rowById.get(byRecord[end])?.overall ?? emptyRecord()) === pct
    ) {
      end++;
    }
    const tied = byRecord.slice(index, end);
    order.push(
      ...(tied.length === 1 ? tied : applyOrder(tied, ctx, scope, trace)),
    );
    index = end;
  }

  return { order, trace };
}
