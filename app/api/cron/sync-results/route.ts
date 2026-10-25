import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { syncPostseason, syncWeek } from "@/lib/ingest";
import { CURRENT_SEASON, TOTAL_WEEKS } from "@/lib/nfl";
import { getCurrentWeek } from "@/lib/queries";

/**
 * Pulls fresh scores and lines from ESPN. Run by Vercel Cron (see
 * vercel.json), which is why it authenticates with a shared secret rather
 * than a session -- there is no browser here.
 *
 * A window of weeks is synced rather than just the current one:
 *   - the previous week, because a Monday night game finishes after the
 *     week has technically rolled over, and because ESPN sometimes corrects
 *     a final score after the fact;
 *   - the current week, for live scores;
 *   - the next two, because that is roughly how far ahead lines are posted,
 *     and a spread nobody can see yet is a spread nobody can pick against.
 */
export const dynamic = "force-dynamic";
// lib/espn.ts now retries a throttled or hung request, so this route is
// slower in the failure case than it used to be and needs a stated ceiling.
// 60s is the Hobby-plan maximum.
export const maxDuration = 60;

/**
 * How long the week loop may spend before it stops starting new weeks.
 *
 * The arithmetic this has to satisfy, worst case, with lib/espn.ts set to
 * three attempts, a 5s per-request timeout and jittered 400ms/800ms
 * backoffs:
 *
 *   one scoreboard request, fully failing = 3 x 5s + 800ms + 1600ms = 17.4s
 *   week loop                             = 19.9s (this gate) + 17.4s = 37.3s
 *   syncPostseason (4 requests, parallel) = 17.4s
 *   total                                 = 54.7s, inside the 60s cap
 *
 * A healthy sync of four weeks takes two to four seconds, so this gate is
 * never reached when ESPN is answering. It only bites when two consecutive
 * weeks have each burned their full retry budget -- at which point ESPN is
 * clearly not serving us and attempting weeks three and four would only add
 * load and risk the function being killed mid-write instead of returning a
 * diagnosable result.
 *
 * The 60s `maxDuration` above is what that arithmetic has to fit inside, and
 * the margin is only four or five seconds -- an end-to-end worst case was
 * measured at 50.7s. It is also a late-season-only risk, because the
 * postseason leg is gated on `current >= TOTAL_WEEKS - 1`, so a comfortable
 * October run proves nothing about January. Raising this budget, or
 * FETCH_TIMEOUT_MS / FETCH_ATTEMPTS in lib/espn.ts, or letting
 * `syncPostseason` fetch its four weeks sequentially rather than through
 * `Promise.all`, each push the total past the cap. That does not degrade
 * gracefully: Vercel kills the function, the scheduler sees a 504, and the
 * `INSERT INTO sync_runs` below never executes -- leaving no record of the
 * one run anybody would want to look at, which is worse than the clean 500
 * this route is written to return.
 */
const WEEK_LOOP_BUDGET_MS = 20_000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Refuse rather
  // than run open if the secret is not configured -- an unauthenticated
  // endpoint that hammers a third-party API is worse than a broken cron.
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const current = await getCurrentWeek();
  const weeks = [current - 1, current, current + 1, current + 2].filter(
    (w) => w >= 1 && w <= TOTAL_WEEKS,
  );

  let gamesUpdated = 0;
  let oddsUpdated = 0;
  const failures: { week: number; error: string }[] = [];

  let postseason: Awaited<ReturnType<typeof syncPostseason>> | null = null;

  const startedAt = Date.now();

  // One try/catch PER WEEK, not one around the loop. The loop used to be
  // wrapped as a whole, which meant a single transient ESPN 403 on the first
  // week aborted the other three as well -- which is why every failed run in
  // sync_runs recorded games_updated=0 rather than partial progress, even
  // though the weeks after the bad one would have synced fine.
  for (const week of weeks) {
    if (Date.now() - startedAt > WEEK_LOOP_BUDGET_MS) {
      failures.push({
        week,
        error: `Skipped: ${WEEK_LOOP_BUDGET_MS / 1000}s sync budget already spent retrying earlier weeks`,
      });
      continue;
    }
    try {
      const outcome = await syncWeek(CURRENT_SEASON, week);
      gamesUpdated += outcome.gamesUpserted;
      oddsUpdated += outcome.oddsUpdated;
    } catch (err) {
      failures.push({
        week,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Only worth asking once the regular season is nearly done -- before
  // then ESPN has no postseason games to derive a bracket from, and this
  // would be four wasted requests every single day from September.
  if (current >= TOTAL_WEEKS - 1) {
    try {
      postseason = await syncPostseason(CURRENT_SEASON);
    } catch (err) {
      // Recorded against week 0 because the bracket is not any one week's.
      failures.push({
        week: 0,
        error: `postseason: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // sync_runs.error stays a single text column, so the per-week failures are
  // flattened into one line. Keeping them in the table is the point: a
  // partial failure that repeats every run for the same week is a real bug,
  // and it is only visible by looking back over the rows.
  const error =
    failures.length > 0
      ? failures.map((f) => `week ${f.week}: ${f.error}`).join("; ")
      : null;

  await sql`
    INSERT INTO sync_runs (weeks_checked, games_updated, odds_updated, error)
    VALUES (${weeks}, ${gamesUpdated}, ${oddsUpdated}, ${error})
  `;

  // Scores changed, so anything derived from them is stale.
  revalidatePath("/leaderboard");
  revalidatePath("/standings");
  revalidatePath("/playoffs");
  revalidatePath("/");
  for (const week of weeks) revalidatePath(`/picks/${week}`);

  // 500 only when NOTHING synced. Both schedulers treat a non-2xx as a red
  // run, and a red run that resolves itself before anybody looks is how a
  // team learns to ignore the red X -- so a blip on one week while the other
  // three landed is reported as a 200 carrying `failedWeeks`, and only a
  // total failure (every week down, i.e. ESPN is genuinely unreachable) goes
  // red. The postseason bracket is excluded from that test on purpose: it is
  // derived data that the next run will pick up, and losing it is not a
  // reason to page anyone.
  const failedWeeks = failures.filter((f) => f.week !== 0);
  const everyWeekFailed = weeks.length > 0 && failedWeeks.length === weeks.length;

  if (everyWeekFailed) {
    return Response.json({ ok: false, weeks, error }, { status: 500 });
  }
  return Response.json({
    ok: true,
    weeks,
    gamesUpdated,
    oddsUpdated,
    postseason,
    // Absent on a clean run so the common case stays easy to read in the
    // workflow's step summary.
    ...(failures.length > 0 ? { failedWeeks: failures } : {}),
  });
}
