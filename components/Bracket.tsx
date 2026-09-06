"use client";

import { useTransition } from "react";
import { TeamLogo } from "@/components/TeamLogo";
import { ROUND_LABELS } from "@/lib/format";
import type { BracketSlot, Matchup, Round } from "@/lib/playoffs";
import type { Team } from "@/lib/types";

type Props = {
  matchups: Matchup[];
  teamById: Map<number, Team>;
  championTeamId: number | null;
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
        <div className="champion-banner relative overflow-hidden rounded-xl border border-accent/50 bg-surface p-6 text-center">
          <div
            aria-hidden
            className="champion-rays pointer-events-none absolute inset-x-0 top-0 h-[200%] opacity-25"
            style={{
              background:
                "conic-gradient(from 0deg at 50% 0%, rgba(213,10,10,.7) 0deg, transparent 22deg, transparent 45deg, rgba(196,202,214,.5) 60deg, transparent 82deg, transparent 120deg, rgba(213,10,10,.7) 150deg, transparent 175deg, transparent 220deg, rgba(196,202,214,.5) 250deg, transparent 275deg, transparent 330deg, rgba(213,10,10,.7) 360deg)",
            }}
          />
          <div className="relative">
            <p className="text-xs uppercase tracking-[0.2em] text-ink-muted">
              Your Super Bowl champion
            </p>
            <div className="champion-logo mt-3 flex flex-col items-center gap-2">
              <TeamLogo
                logoUrl={champion.logoUrl}
                name={champion.name}
                size={72}
                eager
              />
              <p className="text-2xl font-bold text-ink">{champion.name}</p>
            </div>
          </div>
        </div>
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
