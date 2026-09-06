"use client";

import { useOptimistic, useState, useTransition } from "react";
import { TeamLogo } from "@/components/TeamLogo";
import { formatKickoff, formatSpread } from "@/lib/format";
import { MARGIN_BUCKETS } from "@/lib/margin";
import { gradeMargin, gradeStraightUp, type PickGrade } from "@/lib/grade";
import type { Game, Team } from "@/lib/types";

type Props = {
  game: Game;
  home: Team;
  away: Team;
  locked: boolean;
  week: number;
  saveAction: (formData: FormData) => Promise<void>;
};

type Pick = { winner: number | null; bucket: number | null };

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
 * The point spread is shown beside each side but is NOT a control -- the pool
 * picks winners only. It is rendered next to the team it applies to rather
 * than as one line for the game, so "who is favoured, and by how much" reads
 * off the same row as the button you are about to press.
 *
 * The selection is held in useOptimistic, NOT useState, and this matters more
 * than it looks. useState seeds itself once on mount and ignores later props,
 * so this component used to keep showing a pick that the server had already
 * deleted -- "Clear week" removed every row, the page re-rendered with fresh
 * props saying nothing was picked, and all sixteen cards carried on showing
 * the old selection. The clear appeared to do nothing at all. useOptimistic
 * gives the same instant feedback but falls back to the server's value the
 * moment no update of this component's own is in flight, so a clear, a fill,
 * or an edit made in another tab all land correctly.
 *
 * Saving happens per game rather than behind one "save week" button. A week
 * is 13-16 games; batching them means one mis-click loses the lot, and a
 * half-finished week could not be left safely.
 */
export function GamePicker({
  game,
  home,
  away,
  locked,
  week,
  saveAction,
}: Props) {
  const serverPick: Pick = {
    winner: game.predictedWinnerTeamId,
    bucket: game.predictedMarginBucket,
  };
  const [pick, applyOptimistic] = useOptimistic<Pick, Pick>(
    serverPick,
    (_current, next) => next,
  );
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isFinal =
    game.status === "final" && game.homeScore !== null && game.awayScore !== null;

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

  function submit(next: Pick) {
    // A pick needs both halves before it can be stored, so the form waits
    // rather than saving a winner with a placeholder margin.
    if (next.winner === null || next.bucket === null) return;

    const formData = new FormData();
    formData.set("gameId", String(game.id));
    formData.set("week", String(week));
    formData.set("winnerTeamId", String(next.winner));
    formData.set("marginBucket", String(next.bucket));

    setError(null);
    startTransition(async () => {
      // Must be applied inside the transition, or React discards it.
      applyOptimistic(next);
      try {
        await saveAction(formData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save that pick");
      }
    });
  }

  function pickWinner(teamId: number) {
    if (locked) return;
    // Default the margin to a one-score game so a single tap is already a
    // complete pick; the user can still change it.
    submit({ winner: teamId, bucket: pick.bucket ?? 1 });
  }

  function pickBucket(id: number) {
    if (locked || pick.winner === null) return;
    submit({ winner: pick.winner, bucket: id });
  }

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
    <li className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <span>{formatKickoff(game.kickoffAt, game.kickoffTbd)}</span>
        {game.isNeutralSite && (
          <span className="text-neutral-site">Neutral site</span>
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

      <div className="flex flex-col gap-2 sm:flex-row">
        {sideButton(away, false)}
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
              about, and a "Wrong" badge there would read as a second
              penalty for the same mistake. */}
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
