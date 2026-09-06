import { TOTAL_WEEKS } from "./nfl";

export function getWeekLabel(week: number): string {
  return `Week ${week}`;
}

/**
 * Postseason round labels, for the bracket. Weeks 19-22 in ESPN's
 * postseason numbering, though the bracket derives its own rounds rather
 * than reading them from a schedule.
 */
export const ROUND_LABELS = {
  wildcard: "Wild Card",
  divisional: "Divisional",
  conference: "Conference Championship",
  super_bowl: "Super Bowl",
} as const;

export function isRegularSeasonWeek(week: number): boolean {
  return week >= 1 && week <= TOTAL_WEEKS;
}

const kickoffFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

const dateOnlyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
});

/**
 * e.g. "Sun, Sep 13, 1:00 PM EDT" -- resolves EST vs EDT from the date
 * rather than hardcoding either.
 *
 * Everything is shown in Eastern regardless of where the viewer is. That is
 * deliberate: the NFL schedule is published and discussed in Eastern (the
 * "1 o'clock games", "the 4:25 window", "Sunday Night Football"), so a
 * viewer in Denver reading "11:00 AM" for the early window would have to
 * translate it back to talk about it with anyone else.
 *
 * Before a slot is announced or flexed, ESPN publishes a placeholder time.
 * Rendering that verbatim shows a wall of games at midnight, which is not a
 * real time and reads as a bug -- those show the day with "TBD" instead.
 */
export function formatKickoff(
  kickoffAt: string | null,
  kickoffTbd = false,
): string {
  if (!kickoffAt) return "TBD";
  const date = new Date(kickoffAt);
  if (Number.isNaN(date.getTime())) return "TBD";
  if (kickoffTbd) return `${dateOnlyFormatter.format(date)} — TBD`;
  return kickoffFormatter.format(date);
}

/**
 * A spread as a sportsbook would write it for one side: "-3.5", "+7",
 * "PK" for a pick'em. `spread` is always the HOME line, so the away side is
 * its negation.
 */
export function formatSpread(spread: number | null, forHome: boolean): string {
  if (spread === null) return "—";
  const value = forHome ? spread : -spread;
  if (value === 0) return "PK";
  // Trim a trailing ".0" so a whole-number line reads "-3", not "-3.0",
  // while a half-point line keeps its ".5".
  const magnitude = Math.abs(value).toFixed(1).replace(/\.0$/, "");
  return `${value < 0 ? "-" : "+"}${magnitude}`;
}

/** "SEA -3.5" -- the line as ESPN renders it, from the favourite's side. */
export function formatSpreadDetail(
  spread: number | null,
  homeAbbr: string,
  awayAbbr: string,
): string {
  if (spread === null) return "No line";
  if (spread === 0) return "Pick'em";
  const favourite = spread < 0 ? homeAbbr : awayAbbr;
  const magnitude = Math.abs(spread).toFixed(1).replace(/\.0$/, "");
  return `${favourite} -${magnitude}`;
}
