"use client";

import { useState, useTransition } from "react";
import { TeamLogo } from "@/components/TeamLogo";
import { formatKickoff, formatSpread } from "@/lib/format";
import { MARGIN_BUCKETS } from "@/lib/margin";
import { gradeAts, gradeStraightUp, type PickGrade } from "@/lib/grade";
import type { Game, Team } from "@/lib/types";

type Props = {
  game: Game;
  home: Team;
  away: Team;
  locked: boolean;
  week: number;
  saveAction: (formData: FormData) => Promise<void>;
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
  push: "Push",
  none: "No pick",
};

/**
 * One game: a straight-up pick (winner plus how big), and a pick against the
 * spread. They are stored and scored independently, so taking the underdog
 * to cover while still picking the favourite to win is a normal thing to do
 * rather than a contradiction the form has to prevent.
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
  const [winner, setWinner] = useState<number | null>(
    game.predictedWinnerTeamId,
  );
  const [bucket, setBucket] = useState<number | null>(
    game.predictedMarginBucket,
  );
  const [ats, setAts] = useState<number | null>(game.atsTeamId);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const hasLine = game.spread !== null;
  const isFinal =
    game.status === "final" && game.homeScore !== null && game.awayScore !== null;

  // Graded against the line frozen at pick time, not today's -- the same
  // rule the leaderboard uses, so a row can never disagree with the total.
  const suGrade: PickGrade = isFinal
    ? gradeStraightUp(
        game.predictedWinnerTeamId,
        game.homeTeamId,
        game.awayTeamId,
        game.homeScore!,
        game.awayScore!,
      )
    : "none";
  const atsGrade: PickGrade = isFinal
    ? gradeAts(
        game.atsTeamId,
        game.spreadAtPick,
        game.homeTeamId,
        game.awayTeamId,
        game.homeScore!,
        game.awayScore!,
      )
    : "none";

  function submit(next: {
    winner?: number | null;
    bucket?: number | null;
    ats?: number | null;
  }) {
    const winnerTeamId = next.winner !== undefined ? next.winner : winner;
    const marginBucket = next.bucket !== undefined ? next.bucket : bucket;
    const atsTeamId = next.ats !== undefined ? next.ats : ats;

    // A straight-up pick needs both halves before it can be stored, so the
    // form waits rather than saving a winner with a placeholder margin.
    if (winnerTeamId === null || marginBucket === null) return;

    const formData = new FormData();
    formData.set("gameId", String(game.id));
    formData.set("week", String(week));
    formData.set("winnerTeamId", String(winnerTeamId));
    formData.set("marginBucket", String(marginBucket));
    if (atsTeamId !== null) formData.set("atsTeamId", String(atsTeamId));

    setError(null);
    startTransition(async () => {
      try {
        await saveAction(formData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save that pick");
      }
    });
  }

  function pickWinner(teamId: number) {
    if (locked) return;
    setWinner(teamId);
    // Default the margin to a one-score game so a single tap is a complete
    // pick; the user can still change it.
    const nextBucket = bucket ?? 1;
    setBucket(nextBucket);
    submit({ winner: teamId, bucket: nextBucket });
  }

  function pickBucket(id: number) {
    if (locked) return;
    setBucket(id);
    submit({ bucket: id });
  }

  function pickAts(teamId: number) {
    if (locked) return;
    const next = ats === teamId ? null : teamId;
    setAts(next);
    submit({ ats: next });
  }

  const sideButton = (team: Team, isHome: boolean) => {
    const selected = winner === team.id;
    const won =
      isFinal && game.homeScore !== game.awayScore
        ? (game.homeScore! > game.awayScore!) === isHome
        : false;
    return (
      <button
        type="button"
        disabled={locked || pending}
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
        {isFinal && (
          <span
            className={`tabular text-base font-bold ${
              won ? "text-ink" : "text-ink-muted"
            }`}
          >
            {isHome ? game.homeScore : game.awayScore}
          </span>
        )}
      </button>
    );
  };

  const atsButton = (team: Team, isHome: boolean) => {
    const selected = ats === team.id;
    return (
      <button
        type="button"
        disabled={locked || pending || !hasLine}
        onClick={() => pickAts(team.id)}
        aria-pressed={selected}
        aria-label={`Take ${team.name} ${formatSpread(game.spread, isHome)}`}
        className={`tabular flex-1 rounded border px-2 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          selected
            ? "border-neutral-site bg-neutral-site/15 text-ink"
            : "border-line bg-surface-2 text-ink-muted hover:border-line-strong"
        }`}
      >
        {team.abbreviation} {formatSpread(game.spread, isHome)}
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
        {game.overUnder !== null && <span className="tabular">O/U {game.overUnder}</span>}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {sideButton(away, false)}
        {sideButton(home, true)}
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-ink-muted">
            Margin
          </p>
          <div className="flex gap-1">
            {MARGIN_BUCKETS.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={locked || pending || winner === null}
                onClick={() => pickBucket(option.id)}
                aria-pressed={bucket === option.id}
                title={option.name}
                className={`tabular flex-1 rounded border px-1 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  bucket === option.id
                    ? "border-accent bg-accent/15 text-ink"
                    : "border-line bg-surface-2 text-ink-muted hover:border-line-strong"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-ink-muted">
            {hasLine
              ? `Spread${game.oddsProvider ? ` · ${game.oddsProvider}` : ""}`
              : "Spread — not posted yet"}
          </p>
          <div className="flex gap-1">
            {atsButton(away, false)}
            {atsButton(home, true)}
          </div>
        </div>
      </div>

      {isFinal && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <span className={`rounded border px-2 py-0.5 ${GRADE_STYLES[suGrade]}`}>
            Straight up: {GRADE_LABELS[suGrade]}
          </span>
          <span className={`rounded border px-2 py-0.5 ${GRADE_STYLES[atsGrade]}`}>
            Spread: {GRADE_LABELS[atsGrade]}
            {game.spreadAtPick !== null && atsGrade !== "none"
              ? ` (${game.spreadAtPick > 0 ? "+" : ""}${game.spreadAtPick})`
              : ""}
          </span>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-loss">{error}</p>}
    </li>
  );
}
