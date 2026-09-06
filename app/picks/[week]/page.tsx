import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
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

  // Remount key for WeekBoard, which owns the week's picks once the page is
  // open. An individual pick deliberately does NOT revalidate this route, so
  // this signature is unchanged and the client's state survives. Fill and
  // Clear rewrite many rows and DO revalidate, which changes the signature
  // and re-seeds the board from the server.
  const picksSignature = games
    .map(
      (g) =>
        `${g.id}:${g.predictedWinnerTeamId ?? ""}:${g.predictedMarginBucket ?? ""}`,
    )
    .join("|");

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
        key={picksSignature}
        week={week}
        games={games}
        teams={teams}
        lockedGameIds={lockedGameIds}
        saveAction={savePickAction}
        fillAction={fillWeekAction}
        clearAction={clearWeekAction}
      />

    </div>
  );
}
