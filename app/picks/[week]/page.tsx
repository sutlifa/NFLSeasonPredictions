import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { TeamLogo } from "@/components/TeamLogo";
import { WeekBoard } from "@/components/WeekBoard";
import { WeekPager } from "@/components/WeekPager";
import { getWeekLabel } from "@/lib/format";
import { CURRENT_SEASON, WEEKS, isValidWeek } from "@/lib/nfl";
import {
  getTeams,
  getWeekGames,
  getSubmittedWeeks,
  isLocked,
} from "@/lib/queries";
import { clearWeekAction, fillWeekAction, savePickAction } from "./actions";

export default async function PicksPage({ params }: PageProps<"/picks/[week]">) {
  const { week: rawWeek } = await params;
  const week = Number(rawWeek);
  if (!isValidWeek(week)) notFound();

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) notFound();

  const [teams, games, submitted] = await Promise.all([
    getTeams(),
    getWeekGames(userId, week),
    getSubmittedWeeks(userId),
  ]);
  const now = new Date();
  const lockedGameIds = games.filter((g) => isLocked(g, now)).map((g) => g.id);
  const withoutLine = games.filter((g) => g.spread === null).length;

  // Whoever is not on the schedule this week is on a bye. Derived rather than
  // stored: a bye is the absence of a game, and there is nothing to ingest.
  //
  // Guarded on games.length, because a week that has not been loaded yet has
  // no games at all -- which would otherwise list all 32 clubs as being on
  // bye, the most confidently wrong thing the page could say. Weeks 1-4 and
  // 15-18 legitimately have none, and the section simply does not render.
  const playing = new Set(games.flatMap((g) => [g.homeTeamId, g.awayTeamId]));
  const byeTeams =
    games.length === 0 ? [] : teams.filter((team) => !playing.has(team.id));

  return (
    <div className="space-y-5">
      <WeekPager week={week} />

      <h1 className="text-2xl font-bold">
        {getWeekLabel(week)}{" "}
        <span className="text-ink-muted">· {CURRENT_SEASON}</span>
      </h1>

      {/* Weeks read left to right like the schedule does; the current one is
          marked so the strip is navigable without counting. */}
      <nav
        aria-label="Weeks"
        className="flex gap-1 overflow-x-auto rounded border border-line bg-surface p-1.5"
      >
        {WEEKS.map((w) => (
          <Link
            key={w}
            href={`/picks/${w}`}
            aria-current={w === week ? "page" : undefined}
            className={`tabular shrink-0 rounded px-2.5 py-1 text-sm transition-colors ${
              w === week
                ? "bg-accent font-semibold text-accent-ink"
                : submitted.has(w)
                  ? "bg-surface-3 text-ink-soft hover:bg-line"
                  : "text-ink-muted hover:bg-surface-2 hover:text-ink-soft"
            }`}
          >
            {w}
          </Link>
        ))}
      </nav>

      {withoutLine > 0 && (
        <p className="rounded border border-line bg-surface-2 px-3 py-2 text-xs text-ink-muted">
          {withoutLine === games.length
            ? "No point spreads posted for this week yet. Spreads are shown for reference only, so this does not affect picking — but “Fill week” has nothing to work from until a line goes up."
            : `${withoutLine} game${withoutLine === 1 ? " has" : "s have"} no posted spread yet, so “Fill week” will skip ${withoutLine === 1 ? "it" : "them"}.`}
        </p>
      )}

      <WeekBoard
        week={week}
        games={games}
        teams={teams}
        lockedGameIds={lockedGameIds}
        saveAction={savePickAction}
        fillAction={fillWeekAction}
        clearAction={clearWeekAction}
      />

      {byeTeams.length > 0 && (
        <section className="rounded-lg border border-line bg-surface p-3">
          <h2 className="text-[11px] uppercase tracking-wide text-ink-muted">
            On bye ({byeTeams.length})
          </h2>
          {/* Ordered by conference and division, the order getTeams returns,
              so the AFC clubs sit together rather than interleaving. */}
          <ul className="mt-2 flex flex-wrap gap-2">
            {byeTeams.map((team) => (
              <li key={team.id}>
                <Link
                  href={`/teams/${team.id}`}
                  className="flex items-center gap-1.5 rounded border border-line bg-surface-2 px-2 py-1 text-sm text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
                  title={`${team.name} — ${team.conference} ${team.division}`}
                >
                  <TeamLogo logoUrl={team.logoUrl} name={team.name} size={18} />
                  {/* The nickname is not decoration here: two clubs share
                      Los Angeles and two share New York, so the city alone
                      does not say which one is off this week. */}
                  <span>
                    {team.location}{" "}
                    <span className="text-ink-muted">{team.nickname}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
