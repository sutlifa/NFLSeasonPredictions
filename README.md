# NFL Season Predictions

Pick every game of the NFL season through the Super Bowl. Compete with friends.
Have a great time.

Each game takes one pick — who wins, and roughly by how much — and the
leaderboard scores the winner as results come in. Your picks also build your own
version of the season: division and conference standings resolved with the
league's real tiebreakers, and a 14-team playoff bracket seeded from them.

Live at <https://nfl-season-predictions.vercel.app/>.

## What it does

- **Weekly picks.** Pick a winner and roughly how big the margin will be. Point
  spreads are shown beside each side as context but are not pickable. Picks
  lock at each game's kickoff, enforced on the server.
- **Leaderboard.** One point per game whose winner you called. Filterable by
  week or season to date.
- **Standings.** Division and conference tables from your picks, or from the
  real results, with the league's published tiebreaking procedure applied and
  the deciding step named wherever one was actually needed.
- **Playoffs.** Four division winners and three wild cards per conference, a
  bye for the top seed, and a divisional round that reseeds the way the real
  one does.

## Setup

### 1. Database

Provision Postgres and put the connection string in `DATABASE_URL`. On Vercel:
**Storage → Create → Neon**, then `vercel env pull .env.local` to get it
locally. A pooled endpoint is what you want; `lib/db.ts` already sets
`prepare: false` for it.

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL and AUTH_SECRET
npm run db:migrate
npm run seed:teams
npm run seed:schedule
```

`db:migrate` applies `lib/db/schema.sql`, which is idempotent — re-running it
is safe and is how schema changes are rolled out.

### 2. Google sign-in

In the Google Cloud console, create an **OAuth 2.0 Client ID** (Web
application) and add both redirect URIs:

```
https://nfl-season-predictions.vercel.app/api/auth/callback/google
http://localhost:3000/api/auth/callback/google
```

Put the client id and secret in `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, and
generate `AUTH_SECRET` with `openssl rand -base64 32`.

### 3. Deploy

Set every variable from `.env.example` in the Vercel project, then push. The
cron in `vercel.json` pulls fresh scores and lines daily; it authenticates with
`CRON_SECRET` and refuses to run without it.

## Keeping data fresh

The daily cron syncs a window of weeks — the previous one (a Monday night game
finishes after the week has rolled over, and ESPN sometimes corrects a score
after the fact), the current one, and the next two, which is roughly how far
ahead lines are posted.

To repair something by hand:

```bash
curl -X POST "$URL/api/admin/sync?what=teams"       -H "x-admin-secret: $ADMIN_SECRET"
curl -X POST "$URL/api/admin/sync?what=week&week=3" -H "x-admin-secret: $ADMIN_SECRET"
```

A whole season is 18 sequential ESPN calls and will usually exceed the
60-second function limit, so run that from a terminal instead:
`npm run seed:schedule`.

## Verifying the tiebreakers

Rules code fails silently — it produces a plausible order that happens to be
wrong, and nobody notices until a division is decided incorrectly in December.
So there is a check that replays a finished season through the same functions
the app uses and diffs the result against ESPN's own seeds:

```bash
node --import tsx scripts/verify-tiebreakers.ts 2025
```

Both 2025 and 2024 come back 14/14. Those two seasons happen to cover the cases
that actually exercise the rules: an 8-9 division winner seeded above two 12-5
wild cards, two 11-6 division winners split by a tiebreaker, a 9-7-1 club with
a real tie, and three 10-7 clubs competing for two wild-card spots. Run it
after touching anything in `lib/tiebreakers.ts` or `lib/playoffs.ts`.

Two steps of the published procedure are deliberately not implemented, and both
are documented at their position in the list rather than silently skipped: net
touchdowns (a pick records a margin bucket, not a box score) and the final coin
toss, replaced by a stable alphabetical order so a page does not reshuffle
itself between visits.

## Where the data comes from

ESPN's public endpoints — schedule, kickoff times, live scores, logos, team
colours and DraftKings point spreads. There is no free official NFL feed, so
`lib/espn.ts` reads every field defensively and a shape change degrades rather
than throws.

The spread's sign is verified against ESPN's favourite flags rather than
trusted. Nothing is scored against the line, but "Fill week" defaults from it,
so a mis-signed line would hand every auto-filled game to the wrong team.

## Layout

```
lib/espn.ts          ESPN client
lib/ingest.ts        upserts ESPN data into Postgres
lib/standings.ts     tallies results into records and points
lib/tiebreakers.ts   the league's published tiebreaking procedure
lib/playoffs.ts      seeding and the reseeding bracket
lib/grade.ts         how one pick settles (pure -- the client imports this)
lib/scoring.ts       leaderboard totals
lib/queries.ts       everything else that touches the database
```

`lib/grade.ts` is split out from `lib/scoring.ts` on purpose: the pick UI is a
client component and needs the same settlement rules, and importing them from
the scoring module pulled the Postgres driver into the browser bundle.

## Not affiliated

Not affiliated with or endorsed by the National Football League. Team names and
logos are trademarks of their respective owners. Point spreads are shown for
reference only — nothing here takes a wager.
