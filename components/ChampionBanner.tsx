import { TeamLogo } from "./TeamLogo";
import { TrophyIcon } from "./TrophyIcon";
import type { Team } from "@/lib/types";

/**
 * Accepts "#D50A0A", "D50A0A" or "#d00" and returns "#dd0000". Returns null
 * for anything else -- a half-parsed hex would render as a black box rather
 * than fall back to the app's own accent.
 */
function normalizeHex(raw: string | null): string | null {
  if (!raw) return null;
  const hex = raw.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/**
 * The champion's own colours, which cannot be trusted as a text background.
 * NFL primaries run from near-black (the Raiders, the Ravens' deep purple)
 * to bright gold and white, so the ink flips to dark on a light primary
 * rather than assuming the app's white-on-dark default -- otherwise a club
 * like the Steelers or Packers would print its own name invisibly.
 */
function bannerPalette(team: Team | undefined) {
  const primary = normalizeHex(team?.color ?? null);
  const secondary = normalizeHex(team?.altColor ?? null);
  const base = primary ?? "#d50a0a";
  const lum = luminance(base);
  return {
    base,
    ink: lum > 0.45 ? "#12100c" : "#ffffff",
    inkSoft: lum > 0.45 ? "rgba(18,16,12,0.72)" : "rgba(255,255,255,0.78)",
    // Only used for the rule and the rays; falls back to silver when a
    // club's secondary sits so close to its primary that it would vanish
    // (the Raiders' black-on-silver, say, read the wrong way round).
    accent:
      secondary && Math.abs(luminance(secondary) - lum) > 0.12
        ? secondary
        : "#c4cad6",
  };
}

type Props = {
  team: Team;
  seed: number | null;
  record: string | null;
  season: number;
};

/**
 * The payoff for filling in all thirteen games: the club, its mark and its
 * colours, at a size nothing else on the page competes with.
 *
 * Rendered only once a Super Bowl winner has been picked, so it doubles as
 * the signal that the bracket is finished -- there is no other "you're done"
 * state on the page.
 */
export function ChampionBanner({ team, seed, record, season }: Props) {
  const { base, ink, inkSoft, accent } = bannerPalette(team);

  return (
    <section
      aria-label={`${team.name} predicted Super Bowl champion`}
      className="champion-banner relative overflow-hidden rounded-2xl border-2 px-5 py-8 text-center sm:px-10 sm:py-10"
      style={{
        borderColor: accent,
        // Club colour, lifted at the top so the logo plate has something to
        // sit against and darkened at the base so the seed line stays legible.
        backgroundImage: `radial-gradient(120% 140% at 50% -20%, ${base} 0%, ${base} 45%, rgba(0,0,0,0.6) 100%)`,
        color: ink,
      }}
    >
      {/* Rays, purely decorative, kept faint so the name always wins. */}
      <div
        aria-hidden
        className="champion-rays pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage: `repeating-conic-gradient(from 0deg at 50% 0%, ${accent} 0deg 4deg, transparent 4deg 16deg)`,
        }}
      />

      <div className="relative flex flex-col items-center gap-3">
        <p
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em]"
          style={{ color: inkSoft }}
        >
          <span
            className="h-px w-6 sm:w-10"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
          Your {season} Super Bowl champion
          <span
            className="h-px w-6 sm:w-10"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
        </p>

        {/* The plate stays dark whatever the club's colour: these marks are
            drawn to sit on white or on the club's own colour, and a light
            plate behind a dark-primary club reads as a hole in the banner.
            Loaded eagerly -- it is the largest thing on the page and the
            reason the banner exists, so lazy loading left it visibly blank
            on arrival. */}
        <div
          className="champion-logo flex h-28 w-28 items-center justify-center rounded-full border-4 bg-[#060e22] shadow-2xl sm:h-36 sm:w-36"
          style={{ borderColor: accent }}
        >
          <TeamLogo logoUrl={team.logoUrl} name={team.name} size={84} eager />
        </div>

        <div>
          <h2 className="text-3xl font-black leading-none tracking-tight sm:text-5xl">
            {team.location}
          </h2>
          <p
            className="mt-1 text-2xl font-semibold tracking-wide sm:text-4xl"
            style={{ color: accent }}
          >
            {team.nickname}
          </p>
        </div>

        {(seed !== null || record !== null) && (
          <p
            className="tabular text-sm font-medium sm:text-base"
            style={{ color: inkSoft }}
          >
            {seed !== null && `No. ${seed} seed`}
            {seed !== null && record !== null && " · "}
            {record !== null && record}
            {" · "}
            {team.conference}
          </p>
        )}

        <TrophyIcon size={64} className="champion-trophy mt-1" />
      </div>
    </section>
  );
}
