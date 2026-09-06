"use client";

import { useCallback, useState } from "react";
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

/**
 * Owns the week's picks for as long as the page is open.
 *
 * This exists to stop a single pick re-rendering the whole page. Each pick
 * used to call revalidatePath on this very route, so Next re-fetched and
 * re-applied it like a navigation: the page jumped back to the top, and the
 * card flashed. The flash came from useOptimistic, which drops its value the
 * moment its transition ends -- for the beat between that and the refreshed
 * payload landing, the card rendered the STALE server props, so the pick you
 * had just made visibly reverted and then came back.
 *
 * So the committed state lives here in useState rather than being read back
 * off the server after every click, and savePickAction no longer revalidates
 * this route at all. It still revalidates the pages a pick actually feeds
 * (standings, playoffs, leaderboard, home), which the user is not looking at.
 *
 * The counter and the Fill/Clear counts are derived from this state, so they
 * stay live without a round trip.
 *
 * Fill and Clear are different: they rewrite many rows at once, so they DO
 * revalidate this route, and the page hands this component a `key` built from
 * the server's picks. A changed key remounts it and re-seeds from the server;
 * an individual pick leaves the key alone, so nothing is thrown away.
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
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const locked = new Set(lockedGameIds);

  const [picks, setPicks] = useState<Map<number, Pick>>(
    () =>
      new Map(
        games.map((game) => [
          game.id,
          {
            winner: game.predictedWinnerTeamId,
            bucket: game.predictedMarginBucket,
          },
        ]),
      ),
  );
  const [errors, setErrors] = useState<Map<number, string>>(new Map());

  const onPick = useCallback(
    async (gameId: number, next: Pick) => {
      if (next.winner === null || next.bucket === null) return;

      const previous = picks.get(gameId) ?? { winner: null, bucket: null };
      setPicks((current) => new Map(current).set(gameId, next));
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
        // Put it back. The server refused it -- almost always because the
        // game kicked off while the page was open -- so leaving the new pick
        // on screen would be showing something that was never saved.
        setPicks((current) => new Map(current).set(gameId, previous));
        setErrors((current) =>
          new Map(current).set(
            gameId,
            err instanceof Error ? err.message : "Could not save that pick",
          ),
        );
      }
    },
    [picks, saveAction, week],
  );

  const openGames = games.filter((game) => !locked.has(game.id));
  const pickedCount = games.filter(
    (game) => picks.get(game.id)?.winner != null,
  ).length;
  const fillableCount = openGames.filter(
    (game) =>
      picks.get(game.id)?.winner == null &&
      game.spread !== null &&
      game.spread !== 0,
  ).length;
  const clearableCount = openGames.filter(
    (game) => picks.get(game.id)?.winner != null,
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
            week={week}
            fillableCount={fillableCount}
            clearableCount={clearableCount}
            fillAction={fillAction}
            clearAction={clearAction}
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
                pick={picks.get(game.id) ?? { winner: null, bucket: null }}
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
