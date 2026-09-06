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
        odds_updated_at, venue_name, venue_location
      ) VALUES (
        ${game.espnId}, ${season}, ${seasonType}, ${game.week},
        ${homeId}, ${awayId}, ${game.isNeutralSite},
        ${game.kickoffAt}, ${game.kickoffTbd}, ${game.status},
        ${game.homeScore}, ${game.awayScore},
        ${game.spread}, ${game.overUnder}, ${game.oddsProvider},
        ${hasOdds ? new Date() : null},
        ${game.venueName}, ${game.venueLocation}
      )
      ON CONFLICT (espn_id) DO UPDATE SET
        week            = EXCLUDED.week,
        home_team_id    = EXCLUDED.home_team_id,
        away_team_id    = EXCLUDED.away_team_id,
        is_neutral_site = EXCLUDED.is_neutral_site,
        kickoff_at      = EXCLUDED.kickoff_at,
        kickoff_tbd     = EXCLUDED.kickoff_tbd,
        status          = EXCLUDED.status,
        venue_name      = COALESCE(EXCLUDED.venue_name, games.venue_name),
        venue_location  = COALESCE(EXCLUDED.venue_location, games.venue_location),
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

/**
 * Derive the real postseason bracket from ESPN and store it.
 *
 * There is no feed that says "these 14 clubs made the field" -- but the games
 * themselves say it, so the rounds are read off the schedule rather than
 * entered by hand:
 *
 *   field       every club that appears in the wild-card OR divisional round.
 *               The union matters: the two top seeds have a bye and play no
 *               wild-card game, so wild-card clubs alone is 12, not 14.
 *   divisional  the eight clubs in the divisional round.
 *   conference  the four in the conference championships.
 *   super_bowl  the two in the Super Bowl.
 *   champion    whoever won it.
 *
 * A round is only written once its games have actually been scheduled, so an
 * unplayed January leaves the later rounds absent rather than empty -- the
 * bonus scoring treats "absent" as "not yet" and "empty" would read as
 * "nobody got it right".
 *
 * ESPN's postseason weeks: 1 wild card, 2 divisional, 3 conference
 * championship, 4 Pro Bowl (skipped -- it is not a playoff game), 5 Super
 * Bowl.
 */
const POSTSEASON_TYPE = 3;
const POSTSEASON_WEEKS = { wildcard: 1, divisional: 2, conference: 3, superBowl: 5 };

export async function syncPostseason(season: number): Promise<{
  rounds: Record<string, number>;
  championSet: boolean;
}> {
  const teamIds = await teamIdsByEspnId();
  const toIds = (games: EspnGame[]) => {
    const ids = new Set<number>();
    for (const g of games) {
      const home = teamIds.get(g.homeEspnId);
      const away = teamIds.get(g.awayEspnId);
      if (home) ids.add(home);
      if (away) ids.add(away);
    }
    return [...ids];
  };

  const [wildcard, divisional, conference, superBowl] = await Promise.all([
    fetchWeek(season, POSTSEASON_WEEKS.wildcard, POSTSEASON_TYPE),
    fetchWeek(season, POSTSEASON_WEEKS.divisional, POSTSEASON_TYPE),
    fetchWeek(season, POSTSEASON_WEEKS.conference, POSTSEASON_TYPE),
    fetchWeek(season, POSTSEASON_WEEKS.superBowl, POSTSEASON_TYPE),
  ]);

  const sets: Record<string, number[]> = {
    field: toIds([...wildcard, ...divisional]),
    divisional: toIds(divisional),
    conference: toIds(conference),
    super_bowl: toIds(superBowl),
  };

  const written: Record<string, number> = {};
  for (const [round, ids] of Object.entries(sets)) {
    if (ids.length === 0) continue;
    await sql`
      INSERT INTO real_playoff_rounds (season, round, team_ids)
      VALUES (${season}, ${round}, ${ids})
      ON CONFLICT (season, round) DO UPDATE SET
        team_ids = EXCLUDED.team_ids, updated_at = now()
    `;
    written[round] = ids.length;
  }

  // The champion only exists once the Super Bowl has actually finished.
  let championSet = false;
  const final = superBowl.find(
    (g) => g.status === "final" && g.homeScore !== null && g.awayScore !== null,
  );
  if (final && final.homeScore !== final.awayScore) {
    const winnerEspnId =
      final.homeScore! > final.awayScore! ? final.homeEspnId : final.awayEspnId;
    const winnerId = teamIds.get(winnerEspnId);
    if (winnerId) {
      await sql`
        INSERT INTO real_champion (season, team_id)
        VALUES (${season}, ${winnerId})
        ON CONFLICT (season) DO UPDATE SET
          team_id = EXCLUDED.team_id, updated_at = now()
      `;
      championSet = true;
    }
  }

  return { rounds: written, championSet };
}
