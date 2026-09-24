<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- VERCEL BEST PRACTICES START -->
## Best practices for developing on Vercel

These defaults are optimized for AI coding agents (and humans) working on apps that deploy to Vercel.

- Treat Vercel Functions as stateless + ephemeral (no durable RAM/FS, no background daemons), use Blob or marketplace integrations for preserving state
- Edge Functions (standalone) are deprecated; prefer Vercel Functions
- Don't start new projects on Vercel KV/Postgres (both discontinued); use Marketplace Redis/Postgres instead
- Store secrets in Vercel Env Variables; not in git or `NEXT_PUBLIC_*`
- Provision Marketplace native integrations with `vercel integration add` (CI/agent-friendly)
- Sync env + project settings with `vercel env pull` / `vercel pull` when you need local/offline parity
- Use `waitUntil` for post-response work; avoid the deprecated Function `context` parameter
- Set Function regions near your primary data source; avoid cross-region DB/service roundtrips
- Tune Fluid Compute knobs (e.g., `maxDuration`, memory/CPU) for long I/O-heavy calls (LLMs, APIs)
- Use Runtime Cache for fast **regional** caching + tag invalidation (don't treat it as global KV)
- Use Cron Jobs for schedules; cron runs in UTC and triggers your production URL via HTTP GET
- Use Vercel Blob for uploads/media; Use Edge Config for small, globally-read config
- If Enable Deployment Protection is enabled, use a bypass secret to directly access them
- Add OpenTelemetry via `@vercel/otel` on Node; don't expect OTEL support on the Edge runtime
- Enable Web Analytics + Speed Insights early
- Use AI Gateway for model routing, set AI_GATEWAY_API_KEY, using a model string (e.g. 'anthropic/claude-sonnet-4.6'), Gateway is already default in AI SDK
  needed. Always curl https://ai-gateway.vercel.sh/v1/models first; never trust model IDs from memory
- For durable agent loops or untrusted code: use Workflow (pause/resume/state) + Sandbox; use Vercel MCP for secure infra access
<!-- VERCEL BEST PRACTICES END -->

<!--
  Everything below is hand-written and deliberately sits OUTSIDE the two
  marker blocks above. Those are regenerated -- the first by `next dev`, the
  second by Vercel's tooling -- and anything placed inside them is lost on the
  next write.
-->

# Working on this project

NFL Season Predictions. The shared three-agent contract and house stack live in
`AGENT-TEAM.md`, imported alongside this file; this covers only what is true of
*this* repo and would otherwise have to be rediscovered.

## Run it

`preview_start` with the `nfl-dev` config, which is **port 3002**. Port 3000 is
the MTG planner's and 3001 is CFB's; this project's own `.claude/launch.json`
used to say 3000 and silently collided.

## The season is real data, not fixtures

The database holds the actual 2026 season pulled from ESPN: 32 clubs, 272
regular-season games, live point spreads. There are real user accounts with real
picks in it.

**Never delete or rewrite rows that belong to a real account.** When a test
needs a signed-in session, create a throwaway user, use it, and delete it —
`google_id LIKE 'uitest%'` is the convention already in use. Verify the id
exists immediately before minting a token against it: a token that outlives its
user produces a foreign-key violation on save that looks exactly like an app
bug, which has already cost one debugging session.

## Things that are the way they are on purpose

**Do not `revalidatePath` the picks route from a per-pick save.** Every route in
this app is dynamic (they all read the session), so nothing is cached and
`revalidatePath` buys no freshness at all. What it *does* do is make Next
re-fetch and re-apply the current route like a navigation, which throws the page
back to the top mid-pick and makes the card flash as it briefly re-renders from
stale props. `components/WeekBoard.tsx` holds the week's picks client-side and
lets local edits override server props for exactly this reason. Bulk actions
(Fill / Clear) *do* revalidate, because they rewrite many rows at once.

**`lib/grade.ts` is split from `lib/scoring.ts` deliberately.** The pick UI is a
client component and needs the same settlement rules; importing them from the
scoring module pulls the Postgres driver into the browser bundle and the build
fails with a module-not-found wall. Keep pure scoring rules in `grade.ts`.

**Run the tiebreaker check after touching `lib/tiebreakers.ts` or
`lib/playoffs.ts`:**

```bash
node --import tsx scripts/verify-tiebreakers.ts 2025
```

It replays a finished season through the same functions the app uses and diffs
against ESPN's own seeds. Rules code fails silently — it produces a plausible
order that is wrong, and nobody notices until a division is decided incorrectly
in December. 2025 and 2024 both come back 14/14.

**SVG comments must not contain a double hyphen.** XML forbids it, a malformed
SVG does not degrade to something plainer — it fails to render entirely, and a
favicon silently falls back to the browser's default globe. `npm run build` runs
`scripts/check-svg.mjs` first and fails on this; do not route around it.

**CSS `:target` does not work here.** Next applies the URL fragment through the
History API, which does not re-evaluate `:target`, so a CSS-only highlight does
nothing on the in-app navigation it exists for. `components/GameHashHighlight.tsx`
applies the class from JS instead.

**Server error messages never reach the user.** Next masks them in production,
so `err.message` in a client catch is a digest like "Minified React error #441".
Show a fixed, useful sentence instead of the thrown message.

## Scoring lives in one place

`POSTSEASON_POINTS` and `SEASON_POINTS` in `lib/seasonScore.ts` are the whole
tuning surface. The leaderboard columns, the "a perfect bracket is N" copy and
the About page all derive from them — but `app/about/page.tsx` spells a few
figures out in prose, so grep for the old numbers after changing them.

## Keeping data fresh

Two schedulers hit `/api/cron/sync-results`, and both are wanted:

- **Vercel cron** (`vercel.json`), once a day. The Hobby plan caps it there.
  This is the floor that guarantees data arrives.
- **GitHub Actions** (`.github/workflows/sync-results.yml`), every 15 minutes
  during game windows. This is what makes scores timely. GitHub's scheduled
  workflows are best-effort — routinely 5-20 minutes late, occasionally dropped,
  and **disabled entirely after 60 days of repository inactivity**.

Both authenticate with `CRON_SECRET`, held as a Vercel env var and as a GitHub
repo secret. They must match.
