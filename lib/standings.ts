import { representativeScores } from "./margin";
import type { Conference, DivisionKey } from "./nfl";
import {
  emptyRecord,
  isDecided,
  isFinal,
  type Game,
  type StandingsRow,
  type Team,
  type WLT,
} from "./types";

/**
 * One resolved game: two clubs and two numbers. Every standings and
 * tiebreaker calculation works off this, never off a Game -- which is what
 * lets the exact same code rank a user's predicted season and the real one.
 */
export type Result = {
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
};

/**
 * Which season a view is showing. "predicted" reads the user's own picks
 * (via the derived margin scores); "actual" reads real finished results.
 */
export type ResultSource = "predicted" | "actual";

/**
 * Turn games into results, dropping anything not yet decided under the
 * chosen source. A predicted result exists as soon as the user has picked
 * the game; an actual one only once it has been played to a finish.
 */
export function resolveResults(
  games: Game[],
  source: ResultSource,
): Result[] {
  const results: Result[] = [];
  for (const game of games) {
    if (source === "actual") {
      if (!isFinal(game)) continue;
      results.push({
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
      });
      continue;
    }
    if (!isDecided(game)) continue;
    results.push({
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      homeScore: game.predictedHomeScore,
      awayScore: game.predictedAwayScore,
    });
  }
  return results;
}

/**
 * Fill in the derived score pair for a picked game. Kept here rather than in
 * the query layer so there is exactly one place that turns a
 * (winner, margin bucket) pick into the (home, away) pair everything
 * downstream reasons about.
 */
export function applyPredictedScores(game: Game): Game {
  if (game.predictedWinnerTeamId === null || game.predictedMarginBucket === null) {
    return { ...game, predictedHomeScore: null, predictedAwayScore: null };
  }
  const bucket = game.predictedMarginBucket;
  const { winner, loser } = representativeScores(
    (bucket === 0 || bucket === 1 || bucket === 2 || bucket === 3
      ? bucket
      : 0) as 0 | 1 | 2 | 3,
  );
  const homeWon = game.predictedWinnerTeamId === game.homeTeamId;
  return {
    ...game,
    predictedHomeScore: homeWon ? winner : loser,
    predictedAwayScore: homeWon ? loser : winner,
  };
}

function addGame(record: WLT, points: number, against: number) {
  if (points > against) record.wins++;
  else if (points < against) record.losses++;
  else record.ties++;
}

/**
 * Every club's overall, division and conference records plus points for and
 * against. All 32 are present from the start at 0-0, so a standings page
 * reads as a real table in week 1 rather than filling in as picks are made.
 *
 * Ties are counted, not discarded: NFL win percentage treats a tie as half
 * a win, and every tiebreaker step downstream compares win percentages.
 */
export function computeStandings(
  teams: Team[],
  results: Result[],
): StandingsRow[] {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const rows = new Map<number, StandingsRow>();

  for (const team of teams) {
    rows.set(team.id, {
      teamId: team.id,
      team: team.name,
      conf: team.conference,
      div: team.division,
      overall: emptyRecord(),
      divisionRecord: emptyRecord(),
      conferenceRecord: emptyRecord(),
      pointsFor: 0,
      pointsAgainst: 0,
    });
  }

  for (const result of results) {
    const home = teamById.get(result.homeTeamId);
    const away = teamById.get(result.awayTeamId);
    const homeRow = rows.get(result.homeTeamId);
    const awayRow = rows.get(result.awayTeamId);
    if (!home || !away || !homeRow || !awayRow) continue;

    const sameConference = home.conference === away.conference;
    const sameDivision = sameConference && home.division === away.division;

    addGame(homeRow.overall, result.homeScore, result.awayScore);
    addGame(awayRow.overall, result.awayScore, result.homeScore);
    if (sameConference) {
      addGame(homeRow.conferenceRecord, result.homeScore, result.awayScore);
      addGame(awayRow.conferenceRecord, result.awayScore, result.homeScore);
    }
    if (sameDivision) {
      addGame(homeRow.divisionRecord, result.homeScore, result.awayScore);
      addGame(awayRow.divisionRecord, result.awayScore, result.homeScore);
    }

    homeRow.pointsFor += result.homeScore;
    homeRow.pointsAgainst += result.awayScore;
    awayRow.pointsFor += result.awayScore;
    awayRow.pointsAgainst += result.homeScore;
  }

  return Array.from(rows.values());
}

export function groupByDivision(
  rows: StandingsRow[],
): Map<DivisionKey, StandingsRow[]> {
  const grouped = new Map<DivisionKey, StandingsRow[]>();
  for (const row of rows) {
    const key: DivisionKey = `${row.conf} ${row.div}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  return grouped;
}

export function groupByConference(
  rows: StandingsRow[],
): Map<Conference, StandingsRow[]> {
  const grouped = new Map<Conference, StandingsRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.conf) ?? [];
    list.push(row);
    grouped.set(row.conf, list);
  }
  return grouped;
}
