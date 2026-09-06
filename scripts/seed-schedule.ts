// Seeds the full regular-season schedule for a season (defaults to the
// current one). Re-running refreshes kickoff times, scores and lines.
//
//   npm run seed:schedule -- 2026
import { syncSeason } from "../lib/ingest";
import { CURRENT_SEASON } from "../lib/nfl";
import { sql } from "../lib/db";

async function main() {
  const season = Number(process.argv[2] ?? CURRENT_SEASON);
  console.log(`Seeding the ${season} regular season...`);
  const outcome = await syncSeason(season);
  console.log(
    `${outcome.gamesUpserted} games upserted, ` +
      `${outcome.oddsUpdated} with a live line, ${outcome.skipped} skipped.`,
  );
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
