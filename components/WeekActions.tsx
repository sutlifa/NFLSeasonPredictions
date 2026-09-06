"use client";

import { useState, useTransition } from "react";

type Props = {
  /** Open, unpicked games that actually have a line to default from. */
  fillableCount: number;
  /** Picks that could still be removed -- locked games are never touched. */
  clearableCount: number;
  /**
   * Run by the parent rather than called here, so it can drop its local pick
   * overrides once the bulk write has actually landed.
   */
  onFill: () => Promise<void>;
  onClear: () => Promise<void>;
};

/**
 * "Fill week" and "Clear week".
 *
 * Clearing asks first. It is the only control on the page that destroys work
 * rather than changing it, and a mis-tap next to "Fill week" would wipe a
 * whole week of picks with nothing to undo it.
 */
export function WeekActions({
  fillableCount,
  clearableCount,
  onFill,
  onClear,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<void>) {
    startTransition(async () => {
      await action();
      setConfirming(false);
    });
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2 rounded border border-loss/50 bg-loss/10 px-3 py-1.5 text-sm">
        <span className="text-ink-soft">
          Remove {clearableCount} pick{clearableCount === 1 ? "" : "s"}?
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(onClear)}
          className="rounded bg-loss px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Clearing…" : "Clear"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="rounded border border-line-strong px-2.5 py-1 text-xs text-ink-soft"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending || fillableCount === 0}
        onClick={() => run(onFill)}
        title={
          fillableCount === 0
            ? "Nothing left to fill — every open game with a posted line is already picked"
            : "Pick the favourite in every game you have not picked yet"
        }
        className="rounded border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Working…" : `Fill week (${fillableCount})`}
      </button>
      <button
        type="button"
        disabled={pending || clearableCount === 0}
        onClick={() => setConfirming(true)}
        className="rounded border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-loss hover:text-loss disabled:cursor-not-allowed disabled:opacity-40"
      >
        Clear week
      </button>
    </div>
  );
}
