import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { TeamLogo } from "@/components/TeamLogo";
import { CONFERENCES, CURRENT_SEASON, DIVISION_NAMES } from "@/lib/nfl";
import { seedPlayoffs, seedLookup } from "@/lib/playoffs";
import { getSeasonGames, getTeams } from "@/lib/queries";
import {
  computeStandings,
  resolveResults,
  type ResultSource,
} from "@/lib/standings";
import { buildContext, rankTeams } from "@/lib/tiebreakers";
import { formatRecord, winPct, type StandingsRow, type Team } from "@/lib/types";

export const metadata = { title: "Standings · NFL Predictions" };

function pct(value: number): string {
  // ".625" -- the league drops the leading zero on win percentage.
  return value.toFixed(3).replace(/^0/, "");
}

function DivisionTable({
  title,
  rows,
  order,
  trace,
  teamById,
  seeds,
}: {
  title: string;
  rows: Map<number, StandingsRow>;
  order: number[];
  trace: Map<number, string>;
  teamById: Map<number, Team>;
  seeds: Map<number, { seed: number; isDivisionWinner: boolean }>;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <h3 className="border-b border-line bg-surface-2 px-3 py-2 text-sm font-bold tracking-wide text-ink">
        {title}
      </h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
            <th className="px-3 py-1.5 font-medium">Team</th>
            <th className="px-2 py-1.5 text-right font-medium">W-L</th>
            <th className="px-2 py-1.5 text-right font-medium">Pct</th>
            <th className="hidden px-2 py-1.5 text-right font-medium sm:table-cell">
              Div
            </th>
            <th className="hidden px-2 py-1.5 text-right font-medium sm:table-cell">
              Conf
            </th>
            <th className="hidden px-3 py-1.5 text-right font-medium sm:table-cell">
              Diff
            </th>
          </tr>
        </thead>
        <tbody>
          {order.map((teamId, index) => {
            const row = rows.get(teamId);
            const team = teamById.get(teamId);
            if (!row || !team) return null;
            const seed = seeds.get(teamId);
            const diff = row.pointsFor - row.pointsAgainst;
            return (
              <tr
                key={teamId}
                className={`border-t border-line/60 ${
                  index === 0 ? "bg-accent/10" : ""
                }`}
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/teams/${teamId}`}
                    className="flex items-center gap-2 hover:text-accent-strong"
                  >
                    <TeamLogo logoUrl={team.logoUrl} name={team.name} size={22} />
                    <span className="min-w-0 truncate font-medium">
                      {team.location}{" "}
                      <span className="text-ink-muted">{team.nickname}</span>
                    </span>
                    {seed && (
                      <span
                        className={`tabular ml-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          seed.isDivisionWinner
                            ? "bg-accent text-accent-ink"
                            : "bg-surface-3 text-ink-soft"
                        }`}
                        title={
                          seed.isDivisionWinner
                            ? `Division winner — ${seed.seed} seed`
                            : `Wild card — ${seed.seed} seed`
                        }
                      >
                        {seed.seed}
                      </span>
                    )}
                  </Link>
                  {trace.has(teamId) && (
                    <span className="mt-0.5 block text-[10px] text-ink-muted">
                      Tiebreaker: {trace.get(teamId)}
                    </span>
                  )}
                </td>
                <td className="tabular px-2 py-2 text-right font-semibold">
                  {formatRecord(row.overall)}
                </td>
                <td className="tabular px-2 py-2 text-right text-ink-soft">
                  {pct(winPct(row.overall))}
                </td>
                <td className="tabular hidden px-2 py-2 text-right text-ink-muted sm:table-cell">
                  {formatRecord(row.divisionRecord)}
                </td>
                <td className="tabular hidden px-2 py-2 text-right text-ink-muted sm:table-cell">
                  {formatRecord(row.conferenceRecord)}
                </td>
                <td
                  className={`tabular hidden px-3 py-2 text-right sm:table-cell ${
                    diff > 0 ? "text-win" : diff < 0 ? "text-loss" : "text-ink-muted"
                  }`}
                >
                  {diff > 0 ? `+${diff}` : diff}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export default async function StandingsPage({
  searchParams,
}: PageProps<"/standings">) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) notFound();

  const { view } = await searchParams;
  // "mine" reads the user's own picks; "actual" reads real finished results.
  // Same code path either way -- the only difference is which score pair
  // resolveResults hands back.
  const source: ResultSource = view === "actual" ? "actual" : "predicted";

  const [teams, games] = await Promise.all([
    getTeams(),
    getSeasonGames(userId),
  ]);

  const results = resolveResults(games, source);
  const rows = computeStandings(teams, results);
  const rowById = new Map(rows.map((r) => [r.teamId, r]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const ctx = buildContext(teams, rows, results);
  const seeds = seedLookup(seedPlayoffs(teams, ctx));

  const gamesCounted = results.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Standings</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {source === "predicted"
              ? `Your predicted ${CURRENT_SEASON} season`
              : `Actual ${CURRENT_SEASON} results`}{" "}
            · {gamesCounted} game{gamesCounted === 1 ? "" : "s"} counted
          </p>
        </div>
        <div className="flex rounded border border-line bg-surface p-0.5 text-xs">
          <Link
            href="/standings"
            className={`rounded px-3 py-1.5 font-medium ${
              source === "predicted"
                ? "bg-accent text-accent-ink"
                : "text-ink-muted hover:text-ink-soft"
            }`}
          >
            My picks
          </Link>
          <Link
            href="/standings?view=actual"
            className={`rounded px-3 py-1.5 font-medium ${
              source === "actual"
                ? "bg-accent text-accent-ink"
                : "text-ink-muted hover:text-ink-soft"
            }`}
          >
            Actual
          </Link>
        </div>
      </div>

      <p className="rounded border border-line bg-surface-2 px-3 py-2 text-xs text-ink-muted">
        Order within a division follows the league&rsquo;s published tiebreaking
        procedure — head-to-head, then division record, common games,
        conference record, strength of victory and schedule, and on down. Where
        a tiebreaker was actually needed to separate two clubs, the step that
        did it is named under the team.
      </p>

      {CONFERENCES.map((conference) => (
        <section key={conference} className="space-y-3">
          <h2 className="text-lg font-bold tracking-wide text-accent-strong">
            {conference}
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {DIVISION_NAMES.map((division) => {
              const ids = teams
                .filter(
                  (t) => t.conference === conference && t.division === division,
                )
                .map((t) => t.id);
              const { order, trace } = rankTeams(ids, ctx, "division");
              return (
                <DivisionTable
                  key={division}
                  title={`${conference} ${division}`}
                  rows={rowById}
                  order={order}
                  trace={trace}
                  teamById={teamById}
                  seeds={seeds}
                />
              );
            })}
          </div>
        </section>
      ))}

      <p className="text-xs text-ink-muted">
        A number beside a club is its playoff seed — red for a division winner,
        grey for a wild card.
      </p>
    </div>
  );
}
