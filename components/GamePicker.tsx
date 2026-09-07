"use client";

import { TeamLogo } from "@/components/TeamLogo";
import { formatKickoff, formatSpread } from "@/lib/format";
import { MARGIN_BUCKETS } from "@/lib/margin";
import { gradeMargin, gradeStraightUp, type PickGrade } from "@/lib/grade";
import type { Game, Team } from "@/lib/types";

export type Pick = { winner: number | null; bucket: number | null };

type Props = {
  game: Game;
  home: Team;
  away: Team;
  locked: boolean;
  pick: Pick;
  error: string | null;
  onPick: (gameId: number, next: Pick) => void;
};

const GRADE_STYLES: Record<PickGrade, string> = {
  win: "border-win/60 bg-win/15 text-win",
  loss: "border-loss/50 bg-loss/10 text-loss",
  push: "border-push/50 bg-push/10 text-push",
  none: "border-line bg-surface-2 text-ink-muted",
};

const GRADE_LABELS: Record<PickGrade, string> = {
  win: "Correct",
  loss: "Wrong",
  push: "Tie — nobody called it",
  none: "No pick",
};

/**
 * One game: pick a winner, then how big the margin will be.
 *
 * Fully controlled, with no state and no transition of its own. The week's
 * picks live in WeekBoard, which saves them in the background. An earlier
 * version held its selection in useOptimistic here and visibly reverted on
 * every save; the note in WeekBoard explains why.
 *
 * The point spread is shown beside each side but is NOT a control -- the pool
 * picks winners only. It is rendered next to the team it applies to rather
 * than as one line for the game, so "who is favoured, and by how much" reads
 * off the same row as the button you are about to press.
 */
export function GamePicker({
  game,
  home,
  away,
  locked,
  pick,
  error,
  onPick,
}: Props) {
  const isFinal =
    game.status === "final" && game.homeScore !== null && game.awayScore !== null;

  // Grades read the SERVER's pick, not the local one. A finished game cannot
  // be edited, so the two agree -- and reading the stored value keeps the
  // badge honest about what was actually saved and scored.
  const grade: PickGrade = isFinal
    ? gradeStraightUp(
        game.predictedWinnerTeamId,
        game.homeTeamId,
        game.awayTeamId,
        game.homeScore!,
        game.awayScore!,
      )
    : "none";
  const marginGrade: PickGrade = isFinal
    ? gradeMargin(
        game.predictedWinnerTeamId,
        game.predictedMarginBucket,
        game.homeTeamId,
        game.awayTeamId,
        game.homeScore!,
        game.awayScore!,
      )
    : "none";

  function pickWinner(teamId: number) {
    if (locked) return;
    // Default the margin to a one-score game so a single tap is already a
    // complete pick; the user can still change it.
    onPick(game.id, { winner: teamId, bucket: pick.bucket ?? 1 });
  }

  function pickBucket(id: number) {
    if (locked || pick.winner === null) return;
    onPick(game.id, { winner: pick.winner, bucket: id });
  }

  /**
   * Each side is labelled rather than relying on left-to-right order. Away
   * first, home second is the NFL convention, but a two-button row gives no
   * hint of that on its own -- and on a neutral-site game "home" is a
   * scheduling fiction anyway, so those say so rather than implying the club
   * is actually hosting.
   */
  const sideLabel = (isHome: boolean) => {
    if (!isHome) return "Away";
    return game.isNeutralSite ? "Home (neutral)" : "Home";
  };

  const sideButton = (team: Team, isHome: boolean) => {
    const selected = pick.winner === team.id;
    const won =
      isFinal && game.homeScore !== game.awayScore
        ? (game.homeScore! > game.awayScore!) === isHome
        : false;
    return (
      <button
        type="button"
        disabled={locked}
        onClick={() => pickWinner(team.id)}
        aria-pressed={selected}
        className={`flex flex-1 items-center gap-2 rounded border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed ${
          selected
            ? "border-accent bg-accent/15 text-ink"
            : "border-line bg-surface-2 text-ink-soft hover:border-line-strong"
        } ${locked ? "opacity-80" : ""}`}
      >
        <TeamLogo logoUrl={team.logoUrl} name={team.name} size={26} />
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] uppercase tracking-wide text-ink-muted">
            {sideLabel(isHome)}
          </span>
          <span className="block truncate text-sm font-semibold">
            {team.location}
          </span>
          <span className="block truncate text-xs text-ink-muted">
            {team.nickname}
          </span>
        </span>
        {/* Reference only, never a control -- plain text so it cannot read as
            something to press. */}
        {game.spread !== null && (
          <span
            className="tabular shrink-0 text-xs text-ink-muted"
            title={`Point spread: ${team.abbreviation} ${formatSpread(game.spread, isHome)}`}
          >
            {formatSpread(game.spread, isHome)}
          </span>
        )}
        {isFinal && (
          <span
            className={`tabular shrink-0 text-base font-bold ${
              won ? "text-ink" : "text-ink-muted"
            }`}
          >
            {isHome ? game.homeScore : game.awayScore}
          </span>
        )}
      </button>
    );
  };

  return (
    // The anchor a club's schedule links to (/picks/5#game-123). scroll-mt
    // leaves a margin above the card when it is jumped to, so it lands with
    // some context above it rather than flush against the top of the window.
    <li
      id={`game-${game.id}`}
      className="scroll-mt-24 rounded-lg border border-line bg-surface p-3"
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <span>{formatKickoff(game.kickoffAt, game.kickoffTbd)}</span>
        {/* On a neutral-site game the home club's city is misleading -- these
            are the international fixtures, so say where it is actually
            played. */}
        {game.isNeutralSite && (
          <span className="text-neutral-site" title={game.venueName ?? undefined}>
            {game.venueLocation
              ? `Neutral site · ${game.venueLocation}`
              : "Neutral site"}
          </span>
        )}
        {game.status === "in_progress" && (
          <span className="font-semibold text-accent-strong">In progress</span>
        )}
        {locked && game.status === "scheduled" && <span>Locked</span>}
        {game.isDefault && !isFinal && (
          <span className="text-push">Auto-filled</span>
        )}
        {game.overUnder !== null && (
          <span className="tabular">O/U {game.overUnder}</span>
        )}
      </div>

      <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:gap-2">
        {sideButton(away, false)}
        <span
          aria-hidden
          className="shrink-0 text-center text-xs font-semibold text-ink-muted"
        >
          {game.isNeutralSite ? "vs" : "@"}
        </span>
        {sideButton(home, true)}
      </div>

      <div className="mt-2">
        <p className="mb-1 text-[11px] uppercase tracking-wide text-ink-muted">
          Margin of victory
        </p>
        <div className="flex gap-1">
          {MARGIN_BUCKETS.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={locked || pick.winner === null}
              onClick={() => pickBucket(option.id)}
              aria-pressed={pick.bucket === option.id}
              title={option.name}
              className={`tabular flex-1 rounded border px-1 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                pick.bucket === option.id
                  ? "border-accent bg-accent/15 text-ink"
                  : "border-line bg-surface-2 text-ink-muted hover:border-line-strong"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {isFinal && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <span className={`rounded border px-2 py-0.5 ${GRADE_STYLES[grade]}`}>
            Winner: {GRADE_LABELS[grade]}
          </span>
          {/* Only shown when the margin was actually in play -- on a game
              whose winner was missed there is no margin to have been right
              about, and a "Wrong" badge there would read as a second penalty
              for the same mistake. */}
          {marginGrade !== "none" && (
            <span
              className={`rounded border px-2 py-0.5 ${GRADE_STYLES[marginGrade]}`}
            >
              Margin: {marginGrade === "win" ? "+1" : "missed"}
            </span>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-loss">{error}</p>}
    </li>
  );
}
