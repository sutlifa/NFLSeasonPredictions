import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { CURRENT_SEASON, WEEKS, isValidWeek } from "@/lib/nfl";
import { getCurrentWeek } from "@/lib/queries";
import { getLeaderboard, getWeeklyPoints } from "@/lib/scoring";

export const metadata = { title: "Leaderboard · NFL Predictions" };

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default async function LeaderboardPage({
  searchParams,
}: PageProps<"/leaderboard">) {
  const session = await auth();
  const me = session?.user?.id;
  if (!me) notFound();

  const { week: rawWeek } = await searchParams;
  const weekFilter =
    typeof rawWeek === "string" && isValidWeek(Number(rawWeek))
      ? Number(rawWeek)
      : null;

  const [rows, weekly, currentWeek] = await Promise.all([
    getLeaderboard(CURRENT_SEASON, weekFilter ?? undefined),
    getWeeklyPoints(CURRENT_SEASON),
    getCurrentWeek(),
  ]);

  const anyGraded = rows.some((r) => r.gamesGraded > 0);
  // Only weeks that actually have graded games are worth offering as a
  // filter -- a week nobody has played yet returns an empty board that looks
  // broken rather than empty.
  const playedWeeks = WEEKS.filter((w) =>
    [...weekly.values()].some((byWeek) => byWeek.has(w)),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {weekFilter
            ? `Week ${weekFilter} only`
            : `${CURRENT_SEASON} season to date`}{" "}
          · one point for the winner, one for the spread, half for a push
        </p>
      </div>

      {playedWeeks.length > 0 && (
        <nav
          aria-label="Filter by week"
          className="flex flex-wrap items-center gap-1 rounded border border-line bg-surface p-1.5 text-sm"
        >
          <Link
            href="/leaderboard"
            className={`rounded px-2.5 py-1 ${
              weekFilter === null
                ? "bg-accent font-semibold text-accent-ink"
                : "text-ink-muted hover:bg-surface-2 hover:text-ink-soft"
            }`}
          >
            Season
          </Link>
          {playedWeeks.map((w) => (
            <Link
              key={w}
              href={`/leaderboard?week=${w}`}
              className={`tabular rounded px-2.5 py-1 ${
                weekFilter === w
                  ? "bg-accent font-semibold text-accent-ink"
                  : "text-ink-muted hover:bg-surface-2 hover:text-ink-soft"
              }`}
            >
              {w}
            </Link>
          ))}
        </nav>
      )}

      {!anyGraded ? (
        <div className="rounded border border-line bg-surface p-8 text-center">
          <p className="text-ink-soft">Nothing graded yet.</p>
          <p className="mt-1 text-sm text-ink-muted">
            Scores appear here as games finish.{" "}
            <Link href={`/picks/${currentWeek}`} className="text-accent-strong underline">
              Make your week {currentWeek} picks
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">Player</th>
                <th className="px-2 py-2 text-right font-medium">Points</th>
                <th className="px-2 py-2 text-right font-medium">Straight up</th>
                <th className="px-2 py-2 text-right font-medium">
                  Against the spread
                </th>
                <th className="px-3 py-2 text-right font-medium">Games</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.userId}
                  className={`border-t border-line/60 ${
                    row.userId === me ? "bg-accent/10" : ""
                  }`}
                >
                  <td className="tabular px-3 py-2 text-ink-muted">{index + 1}</td>
                  <td className="px-2 py-2">
                    <span className="font-medium">{row.name}</span>
                    {row.userId === me && (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wide text-accent-strong">
                        you
                      </span>
                    )}
                  </td>
                  <td className="tabular px-2 py-2 text-right font-bold">
                    {/* Halves come from pushes, so trim a trailing .0 rather
                        than showing "12.0" next to "12.5". */}
                    {row.points % 1 === 0 ? row.points : row.points.toFixed(1)}
                  </td>
                  <td className="tabular px-2 py-2 text-right text-ink-soft">
                    {row.suWins}-{row.suLosses}
                    <span className="ml-1 text-xs text-ink-muted">
                      {pct(row.suPct)}
                    </span>
                  </td>
                  <td className="tabular px-2 py-2 text-right text-ink-soft">
                    {row.atsWins}-{row.atsLosses}
                    {row.atsPushes > 0 && `-${row.atsPushes}`}
                    <span className="ml-1 text-xs text-ink-muted">
                      {pct(row.atsPct)}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2 text-right text-ink-muted">
                    {row.gamesGraded}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-muted">
        Spread picks are graded against the line as it stood when you picked,
        not the closing line — so a line that moves after you pick cannot
        change what you were scored on.
      </p>
    </div>
  );
}
