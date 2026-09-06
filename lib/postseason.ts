import { sql } from "./db";
import { CONFERENCES, CURRENT_SEASON } from "./nfl";
import {
  buildBracket,
  conferenceSlots,
  seedPlayoffs,
  type BracketSlot,
} from "./playoffs";
import type { PostseasonPrediction, PostseasonTruth } from "./seasonScore";
import { computeStandings, resolveResults } from "./standings";
import { buildContext } from "./tiebreakers";
import type { Game, Team } from "./types";

/**
 * Bridges the pure bonus scorer (lib/seasonScore.ts) to the database: what
 * really happened, and what each person's bracket says will happen.
 */

/** The real bracket so far. Any round not yet played comes back null. */
export async function getPostseasonTruth(
  season: number = CURRENT_SEASON,
): Promise<PostseasonTruth> {
  const [rounds, champion] = await Promise.all([
    sql<{ round: string; team_ids: number[] }[]>`
      SELECT round, team_ids FROM real_playoff_rounds WHERE season = ${season}
    `,
    sql<{ team_id: number }[]>`
      SELECT team_id FROM real_champion WHERE season = ${season}
    `,
  ]);
  const byRound = new Map(rounds.map((r) => [r.round, r.team_ids]));
  return {
    field: byRound.get("field") ?? null,
    divisional: byRound.get("divisional") ?? null,
    conference: byRound.get("conference") ?? null,
    superBowl: byRound.get("super_bowl") ?? null,
    championTeamId: champion[0]?.team_id ?? null,
  };
}

/** True once any part of the real bracket exists -- the bonus is dead weight before then. */
export function truthIsEmpty(truth: PostseasonTruth): boolean {
  return (
    truth.field === null &&
    truth.divisional === null &&
    truth.conference === null &&
    truth.superBowl === null &&
    truth.championTeamId === null
  );
}

/**
 * Reduce one person's season to the club sets the bonus is scored on.
 *
 * The field comes from their predicted standings -- it exists as soon as
 * they have picked enough games, with no bracket needed. The later rounds
 * come from their bracket picks, and a round they have not filled in yet is
 * simply empty, scoring nothing rather than guessing on their behalf.
 *
 * Note which clubs count as "reaching" a round: the divisional round is the
 * top seed (on a bye) plus the three wild-card winners, so a bye club counts
 * as having reached it without any game being picked. That mirrors reality,
 * where the 1 seed is in the divisional round by right.
 */
export function derivePostseasonPrediction(
  teams: Team[],
  games: Game[],
  bracketPicks: Map<BracketSlot, number>,
): PostseasonPrediction {
  const results = resolveResults(games, "predicted");
  const rows = computeStandings(teams, results);
  const ctx = buildContext(teams, rows, results);
  const seeds = seedPlayoffs(teams, ctx);
  const bracket = buildBracket(seeds, bracketPicks);

  const field = CONFERENCES.flatMap((c) => seeds[c].map((s) => s.teamId));

  const divisional: number[] = [];
  const conference: number[] = [];
  const superBowl: number[] = [];

  for (const c of CONFERENCES) {
    const slots = conferenceSlots(c);

    // The 1 seed reaches the divisional round on its bye, not by winning.
    const topSeed = seeds[c].find((s) => s.seed === 1);
    if (topSeed) divisional.push(topSeed.teamId);
    for (const slot of slots.wc) {
      const winner = bracket.matchups.find((m) => m.slot === slot)?.winnerTeamId;
      if (winner != null) divisional.push(winner);
    }

    for (const slot of slots.div) {
      const winner = bracket.matchups.find((m) => m.slot === slot)?.winnerTeamId;
      if (winner != null) conference.push(winner);
    }

    const champ = bracket.matchups.find(
      (m) => m.slot === slots.champ,
    )?.winnerTeamId;
    if (champ != null) superBowl.push(champ);
  }

  return {
    field,
    divisional,
    conference,
    superBowl,
    championTeamId: bracket.championTeamId,
  };
}
