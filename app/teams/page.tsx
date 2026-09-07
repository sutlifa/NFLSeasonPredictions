import Link from "next/link";
import { TeamLogo } from "@/components/TeamLogo";
import { CONFERENCES, DIVISION_NAMES } from "@/lib/nfl";
import { getTeams } from "@/lib/queries";

export const metadata = { title: "Teams · NFL Predictions" };

export default async function TeamsPage() {
  const teams = await getTeams();

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Teams</h1>

      {CONFERENCES.map((conference) => (
        <section key={conference} className="space-y-3">
          <h2 className="text-lg font-bold tracking-wide text-accent-strong">
            {conference}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {DIVISION_NAMES.map((division) => (
              <div
                key={division}
                className="overflow-hidden rounded-lg border border-line bg-surface"
              >
                <h3 className="border-b border-line bg-surface-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-ink-soft">
                  {division}
                </h3>
                <ul>
                  {teams
                    .filter(
                      (t) =>
                        t.conference === conference && t.division === division,
                    )
                    .map((team) => (
                      <li key={team.id} className="border-t border-line/60 first:border-t-0">
                        <Link
                          href={`/teams/${team.id}`}
                          className="flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-surface-2"
                        >
                          <TeamLogo
                            logoUrl={team.logoUrl}
                            name={team.name}
                            size={22}
                          />
                          <span className="min-w-0 truncate">
                            {team.location}{" "}
                            <span className="text-ink-muted">
                              {team.nickname}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
