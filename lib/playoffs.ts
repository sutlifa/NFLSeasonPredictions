import {
  CONFERENCES,
  DIVISION_NAMES,
  PLAYOFF_TEAMS_PER_CONFERENCE,
  type Conference,
} from "./nfl";
import { rankTeams, type TiebreakContext } from "./tiebreakers";
import type { StandingsRow, Team } from "./types";

/**
 * Seeding and the postseason bracket.
 *
 * Seven clubs per conference: the four division winners take seeds 1-4 in
 * record order, and three wild cards take 5-7. Only the top seed sits out
 * the opening round -- the format since the field went to 14 in 2020.
 */

export type Seed = {
  seed: number;
  teamId: number;
  isDivisionWinner: boolean;
  /** Which division it won, for the "clinched" label on the bracket. */
  division: string | null;
};

/**
 * Order a conference's wild-card candidates under the rule people most often
 * get wrong: at any moment only the HIGHEST-RANKED remaining club from each
 * division is eligible for comparison. Once one is taken, the next club from
 * that same division becomes eligible and the comparison is re-run.
 *
 * Applying the conference tiebreakers to every non-winner at once instead
 * would let a division's second AND third club both outrank another
 * division's best -- which the real procedure forbids.
 */
function pickWildCards(
  queuesByDivision: Map<string, number[]>,
  ctx: TiebreakContext,
  count: number,
): number[] {
  const queues = new Map(
    [...queuesByDivision].map(([key, ids]) => [key, [...ids]] as const),
  );
  const chosen: number[] = [];

  for (let i = 0; i < count; i++) {
    const candidates: number[] = [];
    for (const ids of queues.values()) {
      if (ids.length > 0) candidates.push(ids[0]);
    }
    if (candidates.length === 0) break;

    const best = rankTeams(candidates, ctx, "conference").order[0];
    chosen.push(best);
    for (const ids of queues.values()) {
      const index = ids.indexOf(best);
      if (index !== -1) {
        ids.splice(index, 1);
        break;
      }
    }
  }
  return chosen;
}

/** The seven seeds for one conference, in order. */
export function seedConference(
  conference: Conference,
  teams: Team[],
  ctx: TiebreakContext,
): Seed[] {
  const inConference = teams.filter((t) => t.conference === conference);

  const winners: number[] = [];
  const runnersUpByDivision = new Map<string, number[]>();

  for (const division of DIVISION_NAMES) {
    const ids = inConference
      .filter((t) => t.division === division)
      .map((t) => t.id);
    if (ids.length === 0) continue;
    const { order } = rankTeams(ids, ctx, "division");
    winners.push(order[0]);
    runnersUpByDivision.set(division, order.slice(1));
  }

  // Division winners are seeded 1-4 among themselves -- a wild card can
  // never outrank a division winner no matter how much better its record.
  const seededWinners = rankTeams(winners, ctx, "conference").order;
  const wildCards = pickWildCards(
    runnersUpByDivision,
    ctx,
    PLAYOFF_TEAMS_PER_CONFERENCE - seededWinners.length,
  );

  const divisionOf = new Map(inConference.map((t) => [t.id, t.division]));

  return [...seededWinners, ...wildCards].map((teamId, index) => ({
    seed: index + 1,
    teamId,
    isDivisionWinner: index < seededWinners.length,
    division: index < seededWinners.length ? (divisionOf.get(teamId) ?? null) : null,
  }));
}

export function seedPlayoffs(
  teams: Team[],
  ctx: TiebreakContext,
): Record<Conference, Seed[]> {
  return {
    AFC: seedConference("AFC", teams, ctx),
    NFC: seedConference("NFC", teams, ctx),
  };
}

// --- bracket tree --------------------------------------------------------

export type Round = "wildcard" | "divisional" | "conference" | "super_bowl";

/**
 * Every game in the postseason. Wild-card pairings are fixed (2v7, 3v6,
 * 4v5); the divisional round is NOT -- the top seed is re-paired against the
 * lowest surviving seed, which is why `div_1` and `div_2` name positions in
 * the tree rather than fixed matchups.
 */
export type BracketSlot =
  | `${Lowercase<Conference>}_wc_2v7`
  | `${Lowercase<Conference>}_wc_3v6`
  | `${Lowercase<Conference>}_wc_4v5`
  | `${Lowercase<Conference>}_div_1`
  | `${Lowercase<Conference>}_div_2`
  | `${Lowercase<Conference>}_champ`
  | "super_bowl";

export function conferenceSlots(conference: Conference) {
  const c = conference.toLowerCase() as Lowercase<Conference>;
  return {
    wc: [`${c}_wc_2v7`, `${c}_wc_3v6`, `${c}_wc_4v5`] as BracketSlot[],
    div: [`${c}_div_1`, `${c}_div_2`] as BracketSlot[],
    champ: `${c}_champ` as BracketSlot,
  };
}

export const ALL_SLOTS: BracketSlot[] = [
  ...conferenceSlots("AFC").wc,
  ...conferenceSlots("AFC").div,
  conferenceSlots("AFC").champ,
  ...conferenceSlots("NFC").wc,
  ...conferenceSlots("NFC").div,
  conferenceSlots("NFC").champ,
  "super_bowl",
];

/**
 * Slots whose matchup depends on the given slot's winner. Changing a pick
 * clears these, so an earlier change can never leave a now-impossible
 * matchup standing in a later round.
 *
 * Every wild-card game feeds BOTH divisional slots, not one: the divisional
 * round reseeds, so which of the two games a survivor lands in is not known
 * until all three wild-card results are in.
 */
export function downstreamSlots(slot: BracketSlot): BracketSlot[] {
  if (slot === "super_bowl") return [];
  const conference: Conference = slot.startsWith("afc") ? "AFC" : "NFC";
  const slots = conferenceSlots(conference);
  if (slots.wc.includes(slot)) {
    return [...slots.div, slots.champ, "super_bowl"];
  }
  if (slots.div.includes(slot)) {
    return [slots.champ, "super_bowl"];
  }
  return ["super_bowl"];
}

export type Matchup = {
  slot: BracketSlot;
  round: Round;
  conference: Conference | null;
  /** Null until the feeding round has been decided. */
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeSeed: number | null;
  awaySeed: number | null;
  winnerTeamId: number | null;
};

/**
 * Build the full bracket from a conference's seeds plus whatever picks the
 * user has made so far, resolving each round from the one before it.
 */
function buildConferenceBracket(
  conference: Conference,
  seeds: Seed[],
  picks: Map<BracketSlot, number>,
): Matchup[] {
  const slots = conferenceSlots(conference);
  const seedOf = new Map(seeds.map((s) => [s.teamId, s.seed]));
  const teamAtSeed = new Map(seeds.map((s) => [s.seed, s.teamId]));

  const pairings: [number, number][] = [
    [2, 7],
    [3, 6],
    [4, 5],
  ];

  const wildCard: Matchup[] = slots.wc.map((slot, index) => {
    const [highSeed, lowSeed] = pairings[index];
    const homeTeamId = teamAtSeed.get(highSeed) ?? null;
    const awayTeamId = teamAtSeed.get(lowSeed) ?? null;
    const winner = picks.get(slot) ?? null;
    return {
      slot,
      round: "wildcard" as Round,
      conference,
      homeTeamId,
      awayTeamId,
      homeSeed: highSeed,
      awaySeed: lowSeed,
      // Guard against a stale pick naming a club no longer in this game.
      winnerTeamId:
        winner !== null && (winner === homeTeamId || winner === awayTeamId)
          ? winner
          : null,
    };
  });

  const survivors = wildCard
    .map((m) => m.winnerTeamId)
    .filter((id): id is number => id !== null);

  // The divisional round reseeds: the top seed draws the lowest surviving
  // seed, and the other two meet. Nothing can be laid out until all three
  // wild-card games are decided.
  const allWildCardDecided = survivors.length === 3;
  const topSeedTeam = teamAtSeed.get(1) ?? null;

  let divisional: Matchup[];
  if (allWildCardDecided && topSeedTeam !== null) {
    const bySeed = [...survivors].sort(
      (a, b) => (seedOf.get(a) ?? 99) - (seedOf.get(b) ?? 99),
    );
    const lowest = bySeed[bySeed.length - 1];
    const others = bySeed.slice(0, 2);
    divisional = [
      {
        slot: slots.div[0],
        round: "divisional",
        conference,
        homeTeamId: topSeedTeam,
        awayTeamId: lowest,
        homeSeed: 1,
        awaySeed: seedOf.get(lowest) ?? null,
        winnerTeamId: null,
      },
      {
        slot: slots.div[1],
        round: "divisional",
        conference,
        homeTeamId: others[0],
        awayTeamId: others[1],
        homeSeed: seedOf.get(others[0]) ?? null,
        awaySeed: seedOf.get(others[1]) ?? null,
        winnerTeamId: null,
      },
    ];
  } else {
    divisional = slots.div.map((slot, index) => ({
      slot,
      round: "divisional" as Round,
      conference,
      homeTeamId: index === 0 ? topSeedTeam : null,
      awayTeamId: null,
      homeSeed: index === 0 ? 1 : null,
      awaySeed: null,
      winnerTeamId: null,
    }));
  }

  for (const matchup of divisional) {
    const winner = picks.get(matchup.slot) ?? null;
    matchup.winnerTeamId =
      winner !== null &&
      (winner === matchup.homeTeamId || winner === matchup.awayTeamId)
        ? winner
        : null;
  }

  const finalists = divisional
    .map((m) => m.winnerTeamId)
    .filter((id): id is number => id !== null);
  // Higher seed hosts.
  const orderedFinalists = [...finalists].sort(
    (a, b) => (seedOf.get(a) ?? 99) - (seedOf.get(b) ?? 99),
  );
  const champHome = orderedFinalists[0] ?? null;
  const champAway = orderedFinalists[1] ?? null;
  const champPick = picks.get(slots.champ) ?? null;

  const championship: Matchup = {
    slot: slots.champ,
    round: "conference",
    conference,
    homeTeamId: finalists.length === 2 ? champHome : null,
    awayTeamId: finalists.length === 2 ? champAway : null,
    homeSeed: champHome !== null ? (seedOf.get(champHome) ?? null) : null,
    awaySeed: champAway !== null ? (seedOf.get(champAway) ?? null) : null,
    winnerTeamId:
      champPick !== null && (champPick === champHome || champPick === champAway)
        ? champPick
        : null,
  };

  return [...wildCard, ...divisional, championship];
}

export type Bracket = {
  matchups: Matchup[];
  championTeamId: number | null;
};

export function buildBracket(
  seedsByConference: Record<Conference, Seed[]>,
  picks: Map<BracketSlot, number>,
): Bracket {
  const matchups = CONFERENCES.flatMap((conference) =>
    buildConferenceBracket(conference, seedsByConference[conference], picks),
  );

  const afcChampion =
    matchups.find((m) => m.slot === "afc_champ")?.winnerTeamId ?? null;
  const nfcChampion =
    matchups.find((m) => m.slot === "nfc_champ")?.winnerTeamId ?? null;
  const sbPick = picks.get("super_bowl") ?? null;

  // The Super Bowl is always at a neutral site, so there is no home side --
  // the AFC champion is listed first purely by convention.
  const superBowl: Matchup = {
    slot: "super_bowl",
    round: "super_bowl",
    conference: null,
    homeTeamId: afcChampion,
    awayTeamId: nfcChampion,
    homeSeed: null,
    awaySeed: null,
    winnerTeamId:
      sbPick !== null && (sbPick === afcChampion || sbPick === nfcChampion)
        ? sbPick
        : null,
  };

  return {
    matchups: [...matchups, superBowl],
    championTeamId: superBowl.winnerTeamId,
  };
}

/** Playoff seeds keyed by team, for the "clinched" markers on standings. */
export function seedLookup(
  seedsByConference: Record<Conference, Seed[]>,
): Map<number, Seed> {
  const lookup = new Map<number, Seed>();
  for (const conference of CONFERENCES) {
    for (const seed of seedsByConference[conference]) {
      lookup.set(seed.teamId, seed);
    }
  }
  return lookup;
}

export type { StandingsRow };
