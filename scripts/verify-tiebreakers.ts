/**
 * Checks the tiebreaker and seeding code against a real, finished season.
 *
 * Everything in lib/tiebreakers.ts is written from the published rules, and
 * the failure mode for rules code is silent: it produces a plausible order
 * that happens to be wrong, and nobody notices until a division is decided
 * incorrectly in December. So this replays an actual season's results
 * through the same functions the app uses and diffs the resulting seeds
 * against ESPN's own final standings.
 *
 * Needs no database -- it reads ESPN and computes in memory.
 *
 *   node --import tsx scripts/verify-tiebreakers.ts 2025
 */
import { fetchTeams, fetchWeek } from "../lib/espn";
import { CONFERENCES, TOTAL_WEEKS } from "../lib/nfl";
import { computeStandings, type Result } from "../lib/standings";
import { buildContext } from "../lib/tiebreakers";
import { seedPlayoffs } from "../lib/playoffs";
import { formatRecord, type Team } from "../lib/types";

const season = Number(process.argv[2] ?? 2025);

type EspnStandingsEntry = {
  team?: { id?: string; displayName?: string };
  stats?: { name?: string; value?: number; displayValue?: string }[];
};

/**
 * ESPN's own end-of-season standings, used as the source of truth to diff
 * against. `playoffSeed` is the league's real seeding, tiebreakers already
 * applied by whoever actually ran them.
 */
async function fetchEspnSeeds(): Promise<Map<string, number>> {
  const url =
    `https://site.api.espn.com/apis/v2/sports/football/nfl/standings` +
    `?season=${season}&level=1`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN standings ${res.status}`);
  const data = (await res.json()) as {
    children?: { standings?: { entries?: EspnStandingsEntry[] } }[];
    standings?: { entries?: EspnStandingsEntry[] };
  };

  const seeds = new Map<string, number>();
  const groups = data.children ?? [];
  const entries = groups.length
    ? groups.flatMap((g) => g.standings?.entries ?? [])
    : (data.standings?.entries ?? []);

  for (const entry of entries) {
    const id = entry.team?.id;
    const seed = entry.stats?.find((s) => s.name === "playoffSeed")?.value;
    if (id && typeof seed === "number" && seed > 0 && seed <= 7) {
      seeds.set(id, seed);
    }
  }
  return seeds;
}

async function main() {
  console.log(`Verifying against the ${season} season...\n`);

  const espnTeams = await fetchTeams();
  // Fabricate the same shape the app's DB rows produce, so the functions
  // under test are exercised exactly as they are in production.
  const teams: Team[] = espnTeams.map((t, index) => ({
    id: index + 1,
    espnId: t.espnId,
    abbreviation: t.abbreviation,
    name: t.name,
    location: t.location,
    nickname: t.nickname,
    conference: t.conference,
    division: t.division,
    logoUrl: t.logoUrl,
    color: t.color,
    altColor: t.altColor,
  }));
  const idByEspn = new Map(teams.map((t) => [t.espnId, t.id]));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const results: Result[] = [];
  for (let week = 1; week <= TOTAL_WEEKS; week++) {
    const games = await fetchWeek(season, week);
    for (const g of games) {
      if (g.status !== "final" || g.homeScore === null || g.awayScore === null) {
        continue;
      }
      const homeId = idByEspn.get(g.homeEspnId);
      const awayId = idByEspn.get(g.awayEspnId);
      if (!homeId || !awayId) continue;
      results.push({
        homeTeamId: homeId,
        awayTeamId: awayId,
        homeScore: g.homeScore,
        awayScore: g.awayScore,
      });
    }
    process.stdout.write(`  week ${week}: ${results.length} results\r`);
  }
  console.log(`\nLoaded ${results.length} finished games.\n`);

  if (results.length < 200) {
    console.error(
      `Only ${results.length} finished games -- ${season} looks incomplete. ` +
        `Pick a season that has actually ended.`,
    );
    process.exit(1);
  }

  const rows = computeStandings(teams, results);
  const ctx = buildContext(teams, rows, results);
  const seeds = seedPlayoffs(teams, ctx);

  const espnSeeds = await fetchEspnSeeds();
  if (espnSeeds.size === 0) {
    console.error("ESPN returned no playoff seeds -- cannot diff.");
    process.exit(1);
  }

  let mismatches = 0;
  for (const conference of CONFERENCES) {
    console.log(`${conference}`);
    for (const seed of seeds[conference]) {
      const team = teamById.get(seed.teamId)!;
      const row = rows.find((r) => r.teamId === seed.teamId)!;
      const theirs = espnSeeds.get(team.espnId);
      const ok = theirs === seed.seed;
      if (!ok) mismatches++;
      console.log(
        `  ${ok ? "ok  " : "MISS"} ${seed.seed}. ${team.name.padEnd(24)} ` +
          `${formatRecord(row.overall).padEnd(7)} ` +
          `${seed.isDivisionWinner ? `won ${conference} ${seed.division}` : "wild card"}` +
          `${ok ? "" : `   <- ESPN had seed ${theirs ?? "none"}`}`,
      );
    }
    console.log();
  }

  // A club we seeded that the league did not (or vice versa) is a worse
  // error than an ordering difference, so call it out separately.
  const ourEspnIds = new Set(
    CONFERENCES.flatMap((c) =>
      seeds[c].map((s) => teamById.get(s.teamId)!.espnId),
    ),
  );
  for (const [espnId] of espnSeeds) {
    if (!ourEspnIds.has(espnId)) {
      const team = teams.find((t) => t.espnId === espnId);
      console.log(`MISSING FROM OUR FIELD: ${team?.name ?? espnId}`);
      mismatches++;
    }
  }

  if (mismatches === 0) {
    console.log(`All 14 seeds match ESPN for ${season}.`);
  } else {
    console.log(`${mismatches} mismatch(es) against ESPN.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
