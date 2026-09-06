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
  let error: string | null = null;

  let postseason: Awaited<ReturnType<typeof syncPostseason>> | null = null;

  try {
    for (const week of weeks) {
      const outcome = await syncWeek(CURRENT_SEASON, week);
      gamesUpdated += outcome.gamesUpserted;
      oddsUpdated += outcome.oddsUpdated;
    }
    // Only worth asking once the regular season is nearly done -- before
    // then ESPN has no postseason games to derive a bracket from, and this
    // would be four wasted requests every single day from September.
    if (current >= TOTAL_WEEKS - 1) {
      postseason = await syncPostseason(CURRENT_SEASON);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

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

  if (error) {
    return Response.json({ ok: false, weeks, error }, { status: 500 });
  }
  return Response.json({ ok: true, weeks, gamesUpdated, oddsUpdated, postseason });
}
