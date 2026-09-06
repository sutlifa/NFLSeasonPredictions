import Link from "next/link";
import { auth } from "@/auth";
import { TeamLogo } from "@/components/TeamLogo";
import { formatKickoff, formatSpreadDetail } from "@/lib/format";
import { CURRENT_SEASON, TOTAL_WEEKS } from "@/lib/nfl";
import { seedPlayoffs } from "@/lib/playoffs";
import {
  getCurrentWeek,
  getSeasonGames,
  getSubmittedWeeks,
  getTeams,
  getWeekGames,
  isLocked,
} from "@/lib/queries";
import { getLeaderboard } from "@/lib/scoring";
import { computeStandings, resolveResults } from "@/lib/standings";
import { buildContext } from "@/lib/tiebreakers";

function Card({
  href,
  title,
  children,
}: {
  href: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong"
    >
      <h2 className="text-sm font-bold tracking-wide text-accent-strong">
        {title}
      </h2>
      <div className="mt-2 text-sm text-ink-soft">{children}</div>
    </Link>
  );
}

export default async function HomePage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return (
      <div className="mx-auto mt-12 max-w-lg text-center">
        <h1 className="text-3xl font-bold">NFL Season Predictions</h1>
        <p className="mt-3 text-ink-muted">
          Pick every game straight up and against the spread, follow the weekly
          leaderboard, and watch your season play out through real NFL
          standings and the playoff bracket.
        </p>
        <Link
          href="/signin"
          className="mt-6 inline-block rounded bg-accent px-5 py-2.5 font-semibold text-accent-ink hover:bg-accent-strong"
        >
          Sign in to start
        </Link>
      </div>
    );
  }

  const currentWeek = await getCurrentWeek();
  const [teams, weekGames, seasonGames, submitted, leaderboard] =
    await Promise.all([
      getTeams(),
      getWeekGames(userId, currentWeek),
      getSeasonGames(userId),
      getSubmittedWeeks(userId),
      getLeaderboard(CURRENT_SEASON),
    ]);

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const now = new Date();
  const openGames = weekGames.filter((g) => !isLocked(g, now));
  const unpicked = openGames.filter((g) => g.predictedWinnerTeamId === null);
  const nextGame = openGames[0];

  const results = resolveResults(seasonGames, "predicted");
  const rows = computeStandings(teams, results);
  const ctx = buildContext(teams, rows, results);
  const seeds = seedPlayoffs(teams, ctx);

  const me = leaderboard.find((r) => r.userId === userId);
  const myRank = leaderboard.findIndex((r) => r.userId === userId) + 1;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">
          {CURRENT_SEASON} season
          <span className="ml-2 text-base font-normal text-ink-muted">
            Week {currentWeek}
          </span>
        </h1>
      </div>

      <section className="rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">
              {unpicked.length === 0
                ? `Week ${currentWeek} is all picked`
                : `${unpicked.length} game${unpicked.length === 1 ? "" : "s"} left to pick`}
            </h2>
            {nextGame && (
              <p className="mt-1 text-sm text-ink-muted">
                Next kickoff {formatKickoff(nextGame.kickoffAt, nextGame.kickoffTbd)}
              </p>
            )}
          </div>
          <Link
            href={`/picks/${currentWeek}`}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-strong"
          >
            {unpicked.length === 0 ? "Review picks" : "Make picks"}
          </Link>
        </div>

        {unpicked.length > 0 && (
          <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
            {unpicked.slice(0, 4).map((game) => {
              const home = teamById.get(game.homeTeamId);
              const away = teamById.get(game.awayTeamId);
              if (!home || !away) return null;
              return (
                <li
                  key={game.id}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <TeamLogo logoUrl={away.logoUrl} name={away.name} size={18} />
                  <span className="text-ink-soft">{away.abbreviation}</span>
                  <span className="text-ink-muted">at</span>
                  <TeamLogo logoUrl={home.logoUrl} name={home.name} size={18} />
                  <span className="text-ink-soft">{home.abbreviation}</span>
                  <span className="tabular ml-auto text-xs text-ink-muted">
                    {formatSpreadDetail(
                      game.spread,
                      home.abbreviation,
                      away.abbreviation,
                    )}
                  </span>
                </li>
              );
            })}
            {unpicked.length > 4 && (
              <li className="text-xs text-ink-muted">
                and {unpicked.length - 4} more
              </li>
            )}
          </ul>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card href="/leaderboard" title="Leaderboard">
          {me && me.gamesGraded > 0 ? (
            <>
              <span className="text-2xl font-bold text-ink">
                {me.points % 1 === 0 ? me.points : me.points.toFixed(1)}
              </span>{" "}
              points · {myRank === 1 ? "1st" : `#${myRank}`} of{" "}
              {leaderboard.length}
              <p className="mt-1 text-xs text-ink-muted">
                {me.suWins}-{me.suLosses} straight up · {me.atsWins}-
                {me.atsLosses} against the spread
              </p>
            </>
          ) : (
            "No games graded yet this season."
          )}
        </Card>

        <Card href="/standings" title="Standings">
          Your predicted division and conference tables, with the league&rsquo;s
          real tiebreakers applied.
          <p className="mt-1 text-xs text-ink-muted">
            {submitted.size} of {TOTAL_WEEKS} weeks complete
          </p>
        </Card>

        <Card href="/playoffs" title="Playoffs">
          <div className="flex flex-wrap gap-1">
            {[...seeds.AFC.slice(0, 4), ...seeds.NFC.slice(0, 4)].map((seed) => {
              const team = teamById.get(seed.teamId);
              return team ? (
                <TeamLogo
                  key={seed.teamId}
                  logoUrl={team.logoUrl}
                  name={team.name}
                  size={22}
                />
              ) : null;
            })}
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Your projected division winners
          </p>
        </Card>
      </div>
    </div>
  );
}
