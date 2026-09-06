"use client";

import { useTransition } from "react";
import { ChampionBanner } from "@/components/ChampionBanner";
import { TeamLogo } from "@/components/TeamLogo";
import { ROUND_LABELS } from "@/lib/format";
import type { BracketSlot, Matchup, Round } from "@/lib/playoffs";
import type { Team } from "@/lib/types";

type Props = {
  matchups: Matchup[];
  teamById: Map<number, Team>;
  championTeamId: number | null;
  /** Seed and record for the champion's banner line. */
  championSeed: number | null;
  championRecord: string | null;
  season: number;
  pickAction: (formData: FormData) => Promise<void>;
};

const ROUND_ORDER: Round[] = [
  "wildcard",
  "divisional",
  "conference",
  "super_bowl",
];

function MatchupCard({
  matchup,
  teamById,
  onPick,
  pending,
}: {
  matchup: Matchup;
  teamById: Map<number, Team>;
  onPick: (slot: BracketSlot, teamId: number) => void;
  pending: boolean;
}) {
  const sides: { teamId: number | null; seed: number | null }[] = [
    { teamId: matchup.homeTeamId, seed: matchup.homeSeed },
    { teamId: matchup.awayTeamId, seed: matchup.awaySeed },
  ];
  const ready = matchup.homeTeamId !== null && matchup.awayTeamId !== null;

  return (
    <div className="rounded-lg border border-line bg-surface p-2">
      {sides.map((side, index) => {
        const team = side.teamId ? teamById.get(side.teamId) : undefined;
        const selected =
          side.teamId !== null && matchup.winnerTeamId === side.teamId;
        return (
          <button
            key={index}
            type="button"
            disabled={!ready || pending || !team}
            onClick={() => team && onPick(matchup.slot, team.id)}
            aria-pressed={selected}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed ${
              selected
                ? "bg-accent/20 text-ink"
                : team
                  ? "text-ink-soft hover:bg-surface-2"
                  : "text-ink-muted"
            } ${index === 0 ? "mb-0.5" : ""}`}
          >
            {side.seed !== null && (
              <span className="tabular w-4 shrink-0 text-[10px] font-bold text-ink-muted">
                {side.seed}
              </span>
            )}
            {team ? (
              <>
                <TeamLogo logoUrl={team.logoUrl} name={team.name} size={20} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {team.location}
                </span>
                {selected && (
                  <span aria-hidden className="text-xs text-accent-strong">
                    ▸
                  </span>
                )}
              </>
            ) : (
              <span className="flex-1 text-sm italic">
                {/* An empty side means the feeding round has not been decided
                    yet, which is different from a bye -- say which. */}
                Winner of earlier round
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The postseason bracket. Clicking a club advances it, which is enough
 * interaction for a bracket -- there is no margin or spread here, only who
 * survives.
 *
 * The divisional round deliberately shows nothing until all three wild-card
 * games in that conference are picked: the round RESEEDS, so which survivor
 * meets the top seed is genuinely unknown until then. Showing a provisional
 * pairing would be showing a matchup that may not happen.
 */
export function Bracket({
  matchups,
  teamById,
  championTeamId,
  championSeed,
  championRecord,
  season,
  pickAction,
}: Props) {
  const [pending, startTransition] = useTransition();

  function onPick(slot: BracketSlot, teamId: number) {
    const formData = new FormData();
    formData.set("slot", slot);
    formData.set("teamId", String(teamId));
    startTransition(async () => {
      await pickAction(formData);
    });
  }

  const champion = championTeamId ? teamById.get(championTeamId) : undefined;

  const byRound = (round: Round, conference: "AFC" | "NFC" | null) =>
    matchups.filter(
      (m) => m.round === round && (conference === null || m.conference === conference),
    );

  return (
    <div className="space-y-6">
      {champion && (
        <ChampionBanner
          team={champion}
          seed={championSeed}
          record={championRecord}
          season={season}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {(["AFC", "NFC"] as const).map((conference) => (
          <section key={conference} className="space-y-3">
            <h2 className="text-lg font-bold tracking-wide text-accent-strong">
              {conference}
            </h2>
            {ROUND_ORDER.filter((r) => r !== "super_bowl").map((round) => {
              const games = byRound(round, conference);
              if (games.length === 0) return null;
              return (
                <div key={round} className="space-y-2">
                  <h3 className="text-[11px] uppercase tracking-wide text-ink-muted">
                    {ROUND_LABELS[round]}
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                    {games.map((matchup) => (
                      <MatchupCard
                        key={matchup.slot}
                        matchup={matchup}
                        teamById={teamById}
                        onPick={onPick}
                        pending={pending}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-bold tracking-wide text-accent-strong">
          {ROUND_LABELS.super_bowl}
        </h2>
        <div className="mx-auto max-w-sm">
          {byRound("super_bowl", null).map((matchup) => (
            <MatchupCard
              key={matchup.slot}
              matchup={matchup}
              teamById={teamById}
              onPick={onPick}
              pending={pending}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
