"use client";

import { useCallback, useMemo, useState } from "react";
import { GamePicker, type Pick } from "@/components/GamePicker";
import { WeekActions } from "@/components/WeekActions";
import type { Game, Team } from "@/lib/types";

type Props = {
  week: number;
  games: Game[];
  teams: Team[];
  /** Computed on the server, where "now" is authoritative. */
  lockedGameIds: number[];
  saveAction: (formData: FormData) => Promise<void>;
  fillAction: (formData: FormData) => Promise<void>;
  clearAction: (formData: FormData) => Promise<void>;
};

const NO_PICK: Pick = { winner: null, bucket: null };

/**
 * Owns the week's picks for as long as the page is open.
 *
 * This exists to stop a single pick re-rendering the whole page. Picks used
 * to call revalidatePath on the route the user was standing on, so Next
 * re-fetched and re-applied it like a navigation after every click: the page
 * jumped to the top, and the card flashed as it briefly rendered stale
 * server props before the new payload arrived.
 *
 * The model here is LOCAL EDITS WIN. Server props are the baseline; anything
 * the user has touched this session overrides them. That is deliberately
 * more robust than seeding state once and hoping the route never refreshes:
 * an earlier attempt keyed this component on a signature of the server's
 * picks so a refresh would re-seed it, which turned every refresh into a full
 * remount and threw away in-flight picks. Overriding costs nothing and
 * survives a refresh from any source, including one triggered by another
 * page's revalidation.
 *
 * Fill and Clear are the exception: they rewrite many rows at once, so the
 * local overrides are dropped once they finish and the server's version
 * becomes the truth again.
 */
export function WeekBoard({
  week,
  games,
  teams,
  lockedGameIds,
  saveAction,
  fillAction,
  clearAction,
}: Props) {
  const teamById = useMemo(
    () => new Map(teams.map((t) => [t.id, t])),
    [teams],
  );
  const locked = useMemo(() => new Set(lockedGameIds), [lockedGameIds]);

  const serverPicks = useMemo(
    () =>
      new Map<number, Pick>(
        games.map((game) => [
          game.id,
          {
            winner: game.predictedWinnerTeamId,
            bucket: game.predictedMarginBucket,
          },
        ]),
      ),
    [games],
  );

  const [local, setLocal] = useState<Map<number, Pick>>(new Map());
  const [errors, setErrors] = useState<Map<number, string>>(new Map());

  const pickFor = useCallback(
    (gameId: number): Pick => local.get(gameId) ?? serverPicks.get(gameId) ?? NO_PICK,
    [local, serverPicks],
  );

  const onPick = useCallback(
    async (gameId: number, next: Pick) => {
      if (next.winner === null || next.bucket === null) return;

      const hadLocal = local.has(gameId);
      const previous = local.get(gameId);

      setLocal((current) => new Map(current).set(gameId, next));
      setErrors((current) => {
        if (!current.has(gameId)) return current;
        const copy = new Map(current);
        copy.delete(gameId);
        return copy;
      });

      const formData = new FormData();
      formData.set("gameId", String(gameId));
      formData.set("week", String(week));
      formData.set("winnerTeamId", String(next.winner));
      formData.set("marginBucket", String(next.bucket));

      try {
        await saveAction(formData);
      } catch (err) {
        // Put it back. The server refused it, almost always because the game
        // kicked off while the page was open, so leaving the new pick on
        // screen would be showing something that was never saved.
        setLocal((current) => {
          const copy = new Map(current);
          if (hadLocal && previous) copy.set(gameId, previous);
          else copy.delete(gameId);
          return copy;
        });
        setErrors((current) =>
          new Map(current).set(
            gameId,
            err instanceof Error ? err.message : "Could not save that pick",
          ),
        );
      }
    },
    [local, saveAction, week],
  );

  /** Bulk actions rewrite rows wholesale, so local overrides stop applying. */
  const runBulk = useCallback(
    async (action: (formData: FormData) => Promise<void>) => {
      const formData = new FormData();
      formData.set("week", String(week));
      await action(formData);
      setLocal(new Map());
      setErrors(new Map());
    },
    [week],
  );

  const openGames = games.filter((game) => !locked.has(game.id));
  const pickedCount = games.filter((game) => pickFor(game.id).winner != null).length;
  const fillableCount = openGames.filter(
    (game) =>
      pickFor(game.id).winner == null &&
      game.spread !== null &&
      game.spread !== 0,
  ).length;
  const clearableCount = openGames.filter(
    (game) => pickFor(game.id).winner != null,
  ).length;
  const complete = games.length > 0 && pickedCount === games.length;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {games.length === 0
            ? "No games scheduled."
            : `${pickedCount} of ${games.length} picked` +
              (complete ? " · week complete" : "")}
        </p>
        {games.length > 0 && (
          <WeekActions
            fillableCount={fillableCount}
            clearableCount={clearableCount}
            onFill={() => runBulk(fillAction)}
            onClear={() => runBulk(clearAction)}
          />
        )}
      </div>

      {games.length === 0 ? (
        <p className="rounded border border-line bg-surface p-6 text-center text-ink-muted">
          This week has not been loaded yet.
        </p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {games.map((game) => {
            const home = teamById.get(game.homeTeamId);
            const away = teamById.get(game.awayTeamId);
            if (!home || !away) return null;
            return (
              <GamePicker
                key={game.id}
                game={game}
                home={home}
                away={away}
                locked={locked.has(game.id)}
                pick={pickFor(game.id)}
                error={errors.get(game.id) ?? null}
                onPick={onPick}
              />
            );
          })}
        </ul>
      )}
    </>
  );
}
