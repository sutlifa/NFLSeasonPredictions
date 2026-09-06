import { sql } from "./db";
import { fetchTeams, fetchWeek, type EspnGame } from "./espn";
import { REGULAR_SEASON_TYPE, TOTAL_WEEKS } from "./nfl";
import { ESPN_DIVISION_GROUP_IDS } from "./nfl";

/**
 * Writes ESPN data into the database. Everything here is idempotent and
 * upsert-based so a re-run repairs rather than duplicates -- the weekly cron
 * calls the same functions the seed scripts do.
 */

export async function upsertTeams(): Promise<number> {
  const teams = await fetchTeams();

  // Sanity check before writing: eight divisions of exactly four. A silent
  // misalignment here would corrupt every standings page and every playoff
  // seed, so it must fail the seed rather than land in the database.
  const counts = new Map<string, number>();
  for (const team of teams) {
    const key = `${team.conference} ${team.division}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const expected = new Set(Object.values(ESPN_DIVISION_GROUP_IDS));
  for (const key of expected) {
    if (counts.get(key) !== 4) {
      throw new Error(
        `${key} has ${counts.get(key) ?? 0} teams, expected 4. ` +
          `Refusing to seed a broken alignment.`,
      );
    }
  }

  for (const team of teams) {
    await sql`
      INSERT INTO teams (
        espn_id, abbreviation, name, location, nickname,
        conference, division, logo_url, color, alt_color
      ) VALUES (
        ${team.espnId}, ${team.abbreviation}, ${team.name}, ${team.location},
        ${team.nickname}, ${team.conference}, ${team.division},
        ${team.logoUrl}, ${team.color}, ${team.altColor}
      )
      ON CONFLICT (espn_id) DO UPDATE SET
        abbreviation = EXCLUDED.abbreviation,
        name         = EXCLUDED.name,
        location     = EXCLUDED.location,
        nickname     = EXCLUDED.nickname,
        conference   = EXCLUDED.conference,
        division     = EXCLUDED.division,
        logo_url     = EXCLUDED.logo_url,
        color        = EXCLUDED.color,
        alt_color    = EXCLUDED.alt_color
    `;
  }
  return teams.length;
}

async function teamIdsByEspnId(): Promise<Map<string, number>> {
  const rows = await sql<{ id: number; espn_id: string }[]>`
    SELECT id, espn_id FROM teams
  `;
  return new Map(rows.map((r) => [r.espn_id, r.id]));
}

export type SyncOutcome = {
  gamesUpserted: number;
  oddsUpdated: number;
  skipped: number;
};

/**
 * Upsert one week's games.
 *
 * Two things are deliberately NOT overwritten once set:
 *   - A game that has already gone final keeps its score even if a later
 *     ESPN response comes back without one (their scoreboard occasionally
 *     returns an empty score block for an old week).
 *   - Odds stop being updated once a game kicks off. The line at kickoff is
 *     the last one that could possibly have been picked against, and letting
 *     a post-game "closing line" land would rewrite history.
 */
export async function syncWeek(
  season: number,
  week: number,
  seasonType: number = REGULAR_SEASON_TYPE,
): Promise<SyncOutcome> {
  const games = await fetchWeek(season, week, seasonType);
  const teamIds = await teamIdsByEspnId();

  let gamesUpserted = 0;
  let oddsUpdated = 0;
  let skipped = 0;

  for (const game of games) {
    const homeId = teamIds.get(game.homeEspnId);
    const awayId = teamIds.get(game.awayEspnId);
    if (!homeId || !awayId) {
      skipped++;
      continue;
    }

    const hasOdds = game.spread !== null || game.overUnder !== null;

    const result = await sql<{ id: number }[]>`
      INSERT INTO games (
        espn_id, season, season_type, week, home_team_id, away_team_id,
        is_neutral_site, kickoff_at, kickoff_tbd, status,
        home_score, away_score, spread, over_under, odds_provider,
        odds_updated_at
      ) VALUES (
        ${game.espnId}, ${season}, ${seasonType}, ${game.week},
        ${homeId}, ${awayId}, ${game.isNeutralSite},
        ${game.kickoffAt}, ${game.kickoffTbd}, ${game.status},
        ${game.homeScore}, ${game.awayScore},
        ${game.spread}, ${game.overUnder}, ${game.oddsProvider},
        ${hasOdds ? new Date() : null}
      )
      ON CONFLICT (espn_id) DO UPDATE SET
        week            = EXCLUDED.week,
        home_team_id    = EXCLUDED.home_team_id,
        away_team_id    = EXCLUDED.away_team_id,
        is_neutral_site = EXCLUDED.is_neutral_site,
        kickoff_at      = EXCLUDED.kickoff_at,
        kickoff_tbd     = EXCLUDED.kickoff_tbd,
        status          = EXCLUDED.status,
        home_score      = COALESCE(EXCLUDED.home_score, games.home_score),
        away_score      = COALESCE(EXCLUDED.away_score, games.away_score),
        -- Only accept a new line while the game is still ahead of us.
        spread = CASE
          WHEN games.status = 'scheduled' AND EXCLUDED.spread IS NOT NULL
          THEN EXCLUDED.spread ELSE games.spread END,
        over_under = CASE
          WHEN games.status = 'scheduled' AND EXCLUDED.over_under IS NOT NULL
          THEN EXCLUDED.over_under ELSE games.over_under END,
        odds_provider = CASE
          WHEN games.status = 'scheduled' AND EXCLUDED.spread IS NOT NULL
          THEN EXCLUDED.odds_provider ELSE games.odds_provider END,
        odds_updated_at = CASE
          WHEN games.status = 'scheduled' AND EXCLUDED.spread IS NOT NULL
          THEN EXCLUDED.odds_updated_at ELSE games.odds_updated_at END,
        updated_at = now()
      RETURNING id
    `;

    if (result.length > 0) gamesUpserted++;
    if (hasOdds && game.status === "scheduled") oddsUpdated++;
  }

  return { gamesUpserted, oddsUpdated, skipped };
}

/** The whole regular season. Used by the seed script and by admin repair. */
export async function syncSeason(season: number): Promise<SyncOutcome> {
  const total: SyncOutcome = { gamesUpserted: 0, oddsUpdated: 0, skipped: 0 };
  for (let week = 1; week <= TOTAL_WEEKS; week++) {
    const outcome = await syncWeek(season, week);
    total.gamesUpserted += outcome.gamesUpserted;
    total.oddsUpdated += outcome.oddsUpdated;
    total.skipped += outcome.skipped;
  }
  return total;
}

export type { EspnGame };
