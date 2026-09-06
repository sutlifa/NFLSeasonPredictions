import {
  ESPN_CONFERENCE_GROUP_IDS,
  ESPN_DIVISION_GROUP_IDS,
  REGULAR_SEASON_TYPE,
  type Conference,
  type DivisionName,
} from "./nfl";
import type { GameStatus } from "./types";

/**
 * Client for ESPN's public sports API. There is no free, official NFL data
 * feed the way collegefootballdata.com serves the college game, and the
 * paid options all want a contract for what is a hobby pool -- so this
 * reads the same undocumented endpoints ESPN's own scoreboard is built on.
 *
 * Consequences of that choice, which the rest of the app is written to
 * tolerate:
 *   - No API key, no rate limit published. Calls are made from cron and
 *     from seed scripts, never per page view.
 *   - No stability guarantee. Every field is read defensively and a shape
 *     change degrades (a game without a line, a team without a logo) rather
 *     than throwing.
 *   - Odds are whatever book ESPN surfaces, usually DraftKings. The pool
 *     grades against the line frozen at pick time, so a provider change
 *     mid-season cannot rescore anything already picked.
 */

const SITE_API = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const CORE_API =
  "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    // These are ingest calls behind cron and scripts; Next's fetch cache
    // would happily serve a stale scoreboard back during a live sync.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`ESPN ${res.status} ${res.statusText} for ${url}`);
  }
  return (await res.json()) as T;
}

export type EspnTeam = {
  espnId: string;
  abbreviation: string;
  name: string;
  location: string;
  nickname: string;
  conference: Conference;
  division: DivisionName;
  logoUrl: string | null;
  color: string | null;
  altColor: string | null;
};

type TeamsResponse = {
  sports: {
    leagues: {
      teams: {
        team: {
          id: string;
          abbreviation?: string;
          displayName?: string;
          location?: string;
          name?: string;
          color?: string;
          alternateColor?: string;
          logos?: { href: string }[];
        };
      }[];
    }[];
  }[];
};

type TeamDetailResponse = {
  team: {
    id: string;
    groups?: { id: string; parent?: { id: string } };
  };
};

/**
 * All 32 clubs with their alignment.
 *
 * The list endpoint does not carry conference/division, so each club's
 * `groups` block is fetched individually (32 small requests, run once at
 * seed time). Alignment is read from ESPN's own group ids rather than a
 * hardcoded club->division table, because clubs relocate and divisions get
 * redrawn -- but the ids are cross-checked against the table in lib/nfl.ts,
 * so an unrecognised group id fails loudly instead of quietly misfiling a
 * team.
 */
export async function fetchTeams(): Promise<EspnTeam[]> {
  const list = await fetchJson<TeamsResponse>(`${SITE_API}/teams?limit=50`);
  const entries = list.sports?.[0]?.leagues?.[0]?.teams ?? [];
  if (entries.length !== 32) {
    throw new Error(`Expected 32 NFL teams from ESPN, got ${entries.length}`);
  }

  const teams: EspnTeam[] = [];
  for (const entry of entries) {
    const t = entry.team;
    const detail = await fetchJson<TeamDetailResponse>(`${SITE_API}/teams/${t.id}`);
    const groups = detail.team?.groups;
    const divisionKey = groups?.id
      ? ESPN_DIVISION_GROUP_IDS[groups.id]
      : undefined;
    const conference = groups?.parent?.id
      ? ESPN_CONFERENCE_GROUP_IDS[groups.parent.id]
      : undefined;

    if (!divisionKey || !conference) {
      throw new Error(
        `Unrecognised ESPN alignment for ${t.displayName ?? t.id}: ` +
          `division group ${groups?.id ?? "?"}, conference group ` +
          `${groups?.parent?.id ?? "?"}. The league may have realigned -- ` +
          `update ESPN_DIVISION_GROUP_IDS in lib/nfl.ts.`,
      );
    }
    // The division group already encodes its conference ("AFC East"), so a
    // disagreement between the two means one of the ids has been reused.
    const [keyConference, keyDivision] = divisionKey.split(" ") as [
      Conference,
      DivisionName,
    ];
    if (keyConference !== conference) {
      throw new Error(
        `ESPN alignment conflict for ${t.displayName ?? t.id}: division says ` +
          `${keyConference}, conference group says ${conference}.`,
      );
    }

    teams.push({
      espnId: t.id,
      abbreviation: t.abbreviation ?? "",
      name: t.displayName ?? "",
      location: t.location ?? "",
      nickname: t.name ?? "",
      conference,
      division: keyDivision,
      logoUrl: t.logos?.[0]?.href ?? null,
      color: t.color ? `#${t.color}` : null,
      altColor: t.alternateColor ? `#${t.alternateColor}` : null,
    });
  }
  return teams;
}

export type EspnGame = {
  espnId: string;
  week: number;
  seasonType: number;
  homeEspnId: string;
  awayEspnId: string;
  isNeutralSite: boolean;
  kickoffAt: string | null;
  kickoffTbd: boolean;
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
  /** Stadium name, e.g. "Tottenham Hotspur Stadium". */
  venueName: string | null;
  /** Human-readable place, e.g. "London, England" or "Green Bay, WI". */
  venueLocation: string | null;
  /** HOME line: negative means the home side is favoured. */
  spread: number | null;
  overUnder: number | null;
  oddsProvider: string | null;
};

type ScoreboardResponse = {
  events?: {
    id: string;
    date?: string;
    week?: { number?: number };
    status?: {
      type?: { state?: string; completed?: boolean; detail?: string };
    };
    competitions?: {
      neutralSite?: boolean;
      timeValid?: boolean;
      venue?: {
        fullName?: string;
        address?: { city?: string; state?: string; country?: string };
      };
      competitors?: {
        homeAway?: string;
        score?: string;
        team?: { id?: string };
      }[];
      odds?: {
        provider?: { name?: string; priority?: number };
        spread?: number;
        overUnder?: number;
        homeTeamOdds?: { favorite?: boolean; team?: { id?: string } };
        awayTeamOdds?: { favorite?: boolean; team?: { id?: string } };
      }[];
    }[];
  }[];
};

/**
 * ESPN reports `state` as pre/in/post. Map to our own three, treating an
 * abandoned or postponed game as still scheduled -- it either gets replayed
 * or it does not, and until then it must not grade anybody's pick.
 */
/**
 * "London, England" or "Green Bay, WI". ESPN gives `country` on overseas
 * venues and `state` on domestic ones, never both -- country wins where both
 * somehow appear, since "London, England" is what anyone would say.
 */
function formatVenueLocation(
  address: { city?: string; state?: string; country?: string } | undefined,
): string | null {
  const city = address?.city?.trim();
  if (!city) return null;
  const region = address?.country?.trim() || address?.state?.trim();
  return region ? `${city}, ${region}` : city;
}

function toStatus(state: string | undefined, completed: boolean | undefined): GameStatus {
  if (completed) return "final";
  if (state === "in") return "in_progress";
  if (state === "post") return "final";
  return "scheduled";
}

/**
 * Read the home team's spread off an odds block.
 *
 * ESPN's `spread` field is already quoted from the home side, but it is not
 * always present, and several books can be returned for one game. The book
 * with the lowest `priority` is preferred (ESPN's own ordering, DraftKings
 * first in practice); the sign is then verified against the favourite flags
 * rather than trusted, since a mis-signed line silently inverts every ATS
 * pick on that game.
 */
function readOdds(
  competition: NonNullable<ScoreboardResponse["events"]>[number]["competitions"],
  homeEspnId: string | null,
): { spread: number | null; overUnder: number | null; provider: string | null } {
  const blocks = competition?.[0]?.odds ?? [];
  if (blocks.length === 0) {
    return { spread: null, overUnder: null, provider: null };
  }
  const best = [...blocks].sort(
    (a, b) => (a.provider?.priority ?? 99) - (b.provider?.priority ?? 99),
  )[0];

  let spread = typeof best.spread === "number" ? best.spread : null;

  if (spread !== null && spread !== 0) {
    // Trust the `favorite` flag only on the block that actually describes
    // the home club. ESPN has been seen to return the two odds objects in
    // either order, so matching on team id is what makes this reliable;
    // when the ids are absent the flags are taken at face value.
    const homeBlock =
      best.homeTeamOdds?.team?.id != null && homeEspnId != null
        ? best.homeTeamOdds.team.id === homeEspnId
          ? best.homeTeamOdds
          : best.awayTeamOdds
        : best.homeTeamOdds;
    const awayBlock = homeBlock === best.homeTeamOdds ? best.awayTeamOdds : best.homeTeamOdds;

    const homeIsFavourite = homeBlock?.favorite === true;
    const awayIsFavourite = awayBlock?.favorite === true;

    // Only correct when the flags actually disagree with the sign. If
    // neither side is flagged there is nothing to check against, so the
    // number is taken as published.
    if (homeIsFavourite && spread > 0) spread = -spread;
    else if (awayIsFavourite && spread < 0) spread = -spread;
  }

  return {
    spread,
    overUnder: typeof best.overUnder === "number" ? best.overUnder : null,
    provider: best.provider?.name ?? null,
  };
}

/** Every game in one week of one season, with scores and the current line. */
export async function fetchWeek(
  season: number,
  week: number,
  seasonType: number = REGULAR_SEASON_TYPE,
): Promise<EspnGame[]> {
  const data = await fetchJson<ScoreboardResponse>(
    `${SITE_API}/scoreboard?dates=${season}&seasontype=${seasonType}&week=${week}`,
  );

  const games: EspnGame[] = [];
  for (const event of data.events ?? []) {
    const competition = event.competitions?.[0];
    const competitors = competition?.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    const homeId = home?.team?.id;
    const awayId = away?.team?.id;
    // A competition missing either side is not a game we can store -- skip
    // rather than throw, so one malformed event cannot fail a whole sync.
    if (!homeId || !awayId) continue;

    const odds = readOdds(event.competitions, homeId);
    const parseScore = (raw: string | undefined) => {
      if (raw == null || raw === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };

    games.push({
      espnId: event.id,
      week: event.week?.number ?? week,
      seasonType,
      homeEspnId: homeId,
      awayEspnId: awayId,
      isNeutralSite: competition?.neutralSite === true,
      kickoffAt: event.date ?? null,
      // ESPN sets timeValid:false while a slot is still a placeholder --
      // an unflexed late-season Sunday, or a playoff game whose window is
      // known but whose time is not.
      kickoffTbd: competition?.timeValid === false,
      status: toStatus(event.status?.type?.state, event.status?.type?.completed),
      homeScore: parseScore(home?.score),
      awayScore: parseScore(away?.score),
      venueName: competition?.venue?.fullName ?? null,
      venueLocation: formatVenueLocation(competition?.venue?.address),
      spread: odds.spread,
      overUnder: odds.overUnder,
      oddsProvider: odds.provider,
    });
  }
  return games;
}

/** The whole 18-week regular season, fetched one week at a time. */
export async function fetchRegularSeason(season: number): Promise<EspnGame[]> {
  const all: EspnGame[] = [];
  for (let week = 1; week <= 18; week++) {
    all.push(...(await fetchWeek(season, week)));
  }
  return all;
}

export { CORE_API, SITE_API };
