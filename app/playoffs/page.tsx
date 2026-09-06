import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { Bracket } from "@/components/Bracket";
import { TeamLogo } from "@/components/TeamLogo";
import { CONFERENCES, CURRENT_SEASON, TOTAL_WEEKS } from "@/lib/nfl";
import { buildBracket, seedLookup, seedPlayoffs } from "@/lib/playoffs";
import {
  getBracketPicks,
  getSeasonGames,
  getSubmittedWeeks,
  getTeams,
} from "@/lib/queries";
import { computeStandings, resolveResults } from "@/lib/standings";
import { buildContext } from "@/lib/tiebreakers";
import { formatRecord } from "@/lib/types";
import { pickBracketAction } from "./actions";

export const metadata = { title: "Playoffs · NFL Predictions" };

export default async function PlayoffsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) notFound();

  const [teams, games, picks, submitted] = await Promise.all([
    getTeams(),
    getSeasonGames(userId),
    getBracketPicks(userId),
    getSubmittedWeeks(userId),
  ]);

  const results = resolveResults(games, "predicted");
  const rows = computeStandings(teams, results);
  const ctx = buildContext(teams, rows, results);
  const seeds = seedPlayoffs(teams, ctx);
  const bracket = buildBracket(seeds, picks);

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const rowById = new Map(rows.map((r) => [r.teamId, r]));
  const weeksLeft = TOTAL_WEEKS - submitted.size;

  // The banner's subtitle: the champion's seed and its predicted record.
  const championId = bracket.championTeamId;
  const championSeed = championId
    ? (seedLookup(seeds).get(championId)?.seed ?? null)
    : null;
  const championRow = championId ? rowById.get(championId) : undefined;
  const championRecord = championRow ? formatRecord(championRow.overall) : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Playoffs</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Fourteen clubs, seeded from your predicted {CURRENT_SEASON} standings.
        </p>
      </div>

      {weeksLeft > 0 && (
        <p className="rounded border border-push/40 bg-push/10 px-3 py-2 text-xs text-ink-soft">
          {weeksLeft} week{weeksLeft === 1 ? "" : "s"} still unpicked — this
          field is seeded from the games you have decided so far, so it will
          move as you finish the season.
        </p>
      )}

      <section className="grid gap-3 lg:grid-cols-2">
        {CONFERENCES.map((conference) => (
          <div
            key={conference}
            className="overflow-hidden rounded-lg border border-line bg-surface"
          >
            <h2 className="border-b border-line bg-surface-2 px-3 py-2 text-sm font-bold tracking-wide">
              {conference} seeds
            </h2>
            <ol>
              {seeds[conference].map((seed) => {
                const team = teamById.get(seed.teamId);
                const row = rowById.get(seed.teamId);
                if (!team) return null;
                return (
                  <li
                    key={seed.seed}
                    className="flex items-center gap-2 border-t border-line/60 px-3 py-1.5 first:border-t-0"
                  >
                    <span
                      className={`tabular flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
                        seed.isDivisionWinner
                          ? "bg-accent text-accent-ink"
                          : "bg-surface-3 text-ink-soft"
                      }`}
                    >
                      {seed.seed}
                    </span>
                    <TeamLogo logoUrl={team.logoUrl} name={team.name} size={20} />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {team.location}{" "}
                      <span className="text-ink-muted">{team.nickname}</span>
                    </span>
                    <span className="text-[11px] text-ink-muted">
                      {seed.isDivisionWinner
                        ? `${conference} ${seed.division}`
                        : "Wild card"}
                    </span>
                    {row && (
                      <span className="tabular w-12 shrink-0 text-right text-xs text-ink-soft">
                        {formatRecord(row.overall)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
            <p className="border-t border-line/60 px-3 py-1.5 text-[11px] text-ink-muted">
              The 1 seed has the bye.
            </p>
          </div>
        ))}
      </section>

      <Bracket
        matchups={bracket.matchups}
        teamById={teamById}
        championTeamId={bracket.championTeamId}
        championSeed={championSeed}
        championRecord={championRecord}
        season={CURRENT_SEASON}
        pickAction={pickBracketAction}
      />

      <p className="text-xs text-ink-muted">
        The divisional round reseeds — the top seed draws the lowest surviving
        seed — so those matchups stay blank until all three wild-card games in
        that conference are picked.
      </p>
    </div>
  );
}
