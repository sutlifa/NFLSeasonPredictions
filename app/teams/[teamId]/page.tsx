import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { TeamLogo } from "@/components/TeamLogo";
import { formatKickoff, formatSpreadDetail } from "@/lib/format";
import { CURRENT_SEASON } from "@/lib/nfl";
import { getSeasonGames, getTeams } from "@/lib/queries";
import { computeStandings, resolveResults } from "@/lib/standings";
import { formatRecord } from "@/lib/types";

export default async function TeamPage({ params }: PageProps<"/teams/[teamId]">) {
  const { teamId: rawId } = await params;
  const teamId = Number(rawId);
  if (!Number.isInteger(teamId)) notFound();

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) notFound();

  const [teams, games] = await Promise.all([
    getTeams(),
    getSeasonGames(userId),
  ]);
  const team = teams.find((t) => t.id === teamId);
  if (!team) notFound();

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const rows = computeStandings(teams, resolveResults(games, "predicted"));
  const row = rows.find((r) => r.teamId === teamId);

  const schedule = games.filter(
    (g) => g.homeTeamId === teamId || g.awayTeamId === teamId,
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <TeamLogo logoUrl={team.logoUrl} name={team.name} size={56} eager />
        <div>
          <h1 className="text-2xl font-bold">{team.name}</h1>
          <p className="text-sm text-ink-muted">
            {team.conference} {team.division}
            {row && ` · ${formatRecord(row.overall)} predicted`}
          </p>
        </div>
      </div>

      <section className="overflow-hidden rounded-lg border border-line bg-surface">
        <h2 className="border-b border-line bg-surface-2 px-3 py-2 text-sm font-bold">
          {CURRENT_SEASON} schedule
        </h2>
        <ul>
          {schedule.map((game) => {
            const isHome = game.homeTeamId === teamId;
            const opponent = teamById.get(
              isHome ? game.awayTeamId : game.homeTeamId,
            );
            if (!opponent) return null;
            const picked = game.predictedWinnerTeamId;
            const pickedThisTeam = picked === teamId;
            return (
              <li
                key={game.id}
                className="flex flex-wrap items-center gap-2 border-t border-line/60 px-3 py-2 text-sm first:border-t-0"
              >
                <span className="tabular w-12 shrink-0 text-xs text-ink-muted">
                  Wk {game.week}
                </span>
                <span className="w-6 shrink-0 text-xs text-ink-muted">
                  {game.isNeutralSite ? "N" : isHome ? "vs" : "@"}
                </span>
                <Link
                  href={`/teams/${opponent.id}`}
                  className="flex min-w-0 items-center gap-2 hover:text-accent-strong"
                >
                  <TeamLogo
                    logoUrl={opponent.logoUrl}
                    name={opponent.name}
                    size={20}
                  />
                  <span className="truncate">{opponent.location}</span>
                </Link>
                <span className="ml-auto flex items-center gap-3">
                  <span className="tabular text-xs text-ink-muted">
                    {formatSpreadDetail(
                      game.spread,
                      teamById.get(game.homeTeamId)?.abbreviation ?? "",
                      teamById.get(game.awayTeamId)?.abbreviation ?? "",
                    )}
                  </span>
                  {picked === null ? (
                    <span className="text-xs text-ink-muted">No pick</span>
                  ) : (
                    <span
                      className={`text-xs font-semibold ${
                        pickedThisTeam ? "text-win" : "text-loss"
                      }`}
                    >
                      {pickedThisTeam ? "Win" : "Loss"}
                    </span>
                  )}
                </span>
                <span className="w-full text-[11px] text-ink-muted sm:w-auto sm:pl-2">
                  {formatKickoff(game.kickoffAt, game.kickoffTbd)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
