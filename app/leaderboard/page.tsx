import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { CURRENT_SEASON, WEEKS, isValidWeek } from "@/lib/nfl";
import { getCurrentWeek } from "@/lib/queries";
import { getGradedWeeks, getLeaderboard } from "@/lib/scoring";
import { BONUS_ROUNDS, POSTSEASON_POINTS, maxPostseasonPoints } from "@/lib/seasonScore";

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

  const [rows, gradedWeeks, currentWeek] = await Promise.all([
    getLeaderboard(CURRENT_SEASON, weekFilter ?? undefined),
    getGradedWeeks(CURRENT_SEASON),
    getCurrentWeek(),
  ]);

  const anyGraded = rows.some((r) => r.gamesGraded > 0);
  const postseasonLive = rows.some((r) => r.postseason?.scored);
  const playedWeeks = WEEKS.filter((w) => gradedWeeks.has(w));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {weekFilter
            ? `Week ${weekFilter} only`
            : `${CURRENT_SEASON} season to date`}{" "}
          · one point for the winner, one more if the margin lands
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
            <Link
              href={`/picks/${currentWeek}`}
              className="text-accent-strong underline"
            >
              Make your week {currentWeek} picks
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">Player</th>
                <th className="px-2 py-2 text-right font-medium">Total</th>
                <th className="px-2 py-2 text-right font-medium">Winners</th>
                <th className="px-2 py-2 text-right font-medium">Margins</th>
                {postseasonLive && (
                  <th className="px-2 py-2 text-right font-medium">Postseason</th>
                )}
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
                  <td className="tabular px-3 py-2 text-ink-muted">
                    {index + 1}
                  </td>
                  <td className="px-2 py-2">
                    <span className="font-medium">{row.name}</span>
                    {row.userId === me && (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wide text-accent-strong">
                        you
                      </span>
                    )}
                  </td>
                  <td className="tabular px-2 py-2 text-right text-base font-bold">
                    {row.points}
                  </td>
                  <td className="tabular px-2 py-2 text-right text-ink-soft">
                    {row.correct}-{row.wrong}
                    {/* A tied game is neither called nor missed, so it shows
                        as a third figure rather than folded into the losses. */}
                    {row.ties > 0 && `-${row.ties}`}
                    <span className="ml-1 text-xs text-ink-muted">
                      {pct(row.pct)}
                    </span>
                  </td>
                  <td className="tabular px-2 py-2 text-right text-ink-soft">
                    {row.margins}
                    <span className="ml-1 text-xs text-ink-muted">
                      {pct(row.marginPct)}
                    </span>
                  </td>
                  {postseasonLive && (
                    <td className="tabular px-2 py-2 text-right text-ink-soft">
                      {row.postseasonPoints > 0 ? (
                        <span className="font-semibold text-accent-strong">
                          +{row.postseasonPoints}
                        </span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                      {row.postseason?.championCorrect && (
                        <span
                          className="ml-1"
                          title="Called the Super Bowl champion"
                          aria-label="Called the Super Bowl champion"
                        >
                          🏆
                        </span>
                      )}
                    </td>
                  )}
                  <td className="tabular px-3 py-2 text-right text-ink-muted">
                    {row.gamesGraded}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {postseasonLive && (
        <section className="overflow-hidden rounded-lg border border-line bg-surface">
          <h2 className="border-b border-line bg-surface-2 px-3 py-2 text-sm font-bold">
            Postseason bonus
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2 font-medium">Player</th>
                  {BONUS_ROUNDS.map((round) => (
                    <th
                      key={round.key}
                      className="px-2 py-2 text-right font-medium"
                      // `points` is widened to number on purpose: as a literal
                      // union it is currently 2|4|8|16, so TypeScript rejects
                      // a comparison against 1 as impossible -- and the
                      // pluralisation would then silently break if the ladder
                      // were ever retuned back down to 1.
                      title={`${round.points} ${(round.points as number) === 1 ? "point" : "points"} per club`}
                    >
                      {round.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Champion</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.userId} className="border-t border-line/60">
                    <td className="px-3 py-2">{row.name}</td>
                    {BONUS_ROUNDS.map((round) => {
                      const scored = row.postseason?.rounds.find(
                        (r) => r.key === round.key,
                      );
                      return (
                        <td
                          key={round.key}
                          className="tabular px-2 py-2 text-right text-ink-soft"
                        >
                          {scored && scored.possible > 0 ? (
                            <>
                              {scored.hits}/{scored.possible}
                              <span className="ml-1 text-xs text-ink-muted">
                                +{scored.points}
                              </span>
                            </>
                          ) : (
                            <span className="text-ink-muted">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="tabular px-3 py-2 text-right">
                      {row.postseason?.championCorrect ? (
                        <span className="font-semibold text-win">
                          +{POSTSEASON_POINTS.champion}
                        </span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="space-y-1 text-xs text-ink-muted">
        <p>
          <strong className="text-ink-soft">Regular season.</strong> One point
          for every game whose winner you called, and one more where the margin
          bucket landed too. The margin only pays on a game you already got
          right — matching the bucket while having the wrong club win is a
          coincidence, not a read.
        </p>
        <p>
          <strong className="text-ink-soft">Postseason.</strong> Your bracket is
          paid per club that actually reached each round, doubling as it goes:{" "}
          {BONUS_ROUNDS.map((r) => `${r.points} for ${r.label.toLowerCase()}`).join(
            ", ",
          )}
          , then {POSTSEASON_POINTS.champion} for the Super Bowl champion. A
          perfect bracket is {maxPostseasonPoints()} points. Rounds that have
          not been played yet show as “—” rather than as a miss.
        </p>
        <p>
          Point spreads are shown beside each game for reference only — nothing
          is picked or scored against them.
        </p>
      </div>
    </div>
  );
}
