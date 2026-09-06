import { upsertTeams, syncPostseason, syncSeason, syncWeek } from "@/lib/ingest";
import { CURRENT_SEASON } from "@/lib/nfl";

/**
 * Manual repair hatch: reseed the clubs, or re-pull a week or a whole
 * season. Authenticated with ADMIN_SECRET in a header rather than a session,
 * so it can be called with curl during setup before anyone has signed in.
 *
 *   curl -X POST "$URL/api/admin/sync?what=teams" -H "x-admin-secret: ..."
 *   curl -X POST "$URL/api/admin/sync?what=season&season=2026" -H "..."
 *   curl -X POST "$URL/api/admin/sync?what=week&week=3" -H "..."
 *   curl -X POST "$URL/api/admin/sync?what=postseason" -H "..."
 */
export const dynamic = "force-dynamic";
// Hobby-plan functions are capped at 60s, so `what=season` (18 sequential
// ESPN calls) will usually time out here. Seed a whole season from a
// terminal instead -- `npm run seed:schedule` runs the same code with no
// time limit. This route is for reseeding teams or repairing one week.
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || request.headers.get("x-admin-secret") !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const what = url.searchParams.get("what") ?? "week";
  const season = Number(url.searchParams.get("season") ?? CURRENT_SEASON);

  try {
    if (what === "teams") {
      const count = await upsertTeams();
      return Response.json({ ok: true, teams: count });
    }
    if (what === "season") {
      const outcome = await syncSeason(season);
      return Response.json({ ok: true, season, ...outcome });
    }
    if (what === "postseason") {
      const outcome = await syncPostseason(season);
      return Response.json({ ok: true, season, ...outcome });
    }
    if (what === "week") {
      const week = Number(url.searchParams.get("week"));
      if (!Number.isInteger(week)) {
        return Response.json({ error: "week is required" }, { status: 400 });
      }
      const outcome = await syncWeek(season, week);
      return Response.json({ ok: true, season, week, ...outcome });
    }
    return Response.json({ error: `Unknown what=${what}` }, { status: 400 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
