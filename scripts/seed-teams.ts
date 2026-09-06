// Seeds the 32 clubs from ESPN. Safe to re-run: upserts on espn_id, so it
// also serves as the repair path if a logo or colour changes.
import { upsertTeams } from "../lib/ingest";
import { sql } from "../lib/db";

async function main() {
  const count = await upsertTeams();
  console.log(`Seeded ${count} teams.`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
