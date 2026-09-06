-- NFL Season Predictions schema. Idempotent: every statement is guarded so
-- `npm run db:migrate` can be re-run against an existing database.

-- All 32 clubs, seeded from ESPN's public teams endpoint (lib/espn.ts).
-- Unlike the college app there is no "non-FBS opponent" case -- the league
-- is a closed set of 32, so every game references two real rows here.
CREATE TABLE IF NOT EXISTS teams (
  id            SERIAL PRIMARY KEY,
  espn_id       TEXT NOT NULL UNIQUE,
  abbreviation  TEXT NOT NULL UNIQUE,       -- 'BUF'
  name          TEXT NOT NULL UNIQUE,       -- 'Buffalo Bills'
  location      TEXT NOT NULL,              -- 'Buffalo'
  nickname      TEXT NOT NULL,              -- 'Bills'
  conference    TEXT NOT NULL CHECK (conference IN ('AFC', 'NFC')),
  division      TEXT NOT NULL CHECK (division IN ('East', 'North', 'South', 'West')),
  logo_url      TEXT,
  color         TEXT,
  alt_color     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  google_id   TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT,
  image       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The shared schedule plus real results. Every row is league-wide; nothing
-- here is per-user (predictions live in their own table). Playoff games are
-- NOT stored here -- each user's bracket is derived from their own predicted
-- standings, so two users hold different postseason matchups and there is no
-- single shared row to store (see bracket_picks).
--
-- `spread` is the HOME team's line, matching how a sportsbook quotes it:
-- -3.5 means the home team is favoured by 3.5. Kept in sync from ESPN until
-- kickoff, then left alone. Nothing is picked or scored against it -- it is
-- shown beside a game as the market's own read, and is what "Fill week"
-- defaults from.
CREATE TABLE IF NOT EXISTS games (
  id               SERIAL PRIMARY KEY,
  espn_id          TEXT UNIQUE,
  season           INTEGER NOT NULL,
  -- ESPN's seasontype: 2 = regular season, 3 = postseason. Only 2 is
  -- ingested today; the column exists so real playoff results can be stored
  -- later without a migration.
  season_type      INTEGER NOT NULL DEFAULT 2,
  week             INTEGER NOT NULL CHECK (week BETWEEN 1 AND 22),
  home_team_id     INTEGER NOT NULL REFERENCES teams(id),
  away_team_id     INTEGER NOT NULL REFERENCES teams(id),
  -- International games (London, Munich, Sao Paulo, Dublin, Madrid) and the
  -- Super Bowl. One club is still nominally "home" for scheduling purposes.
  is_neutral_site  BOOLEAN NOT NULL DEFAULT FALSE,
  kickoff_at       TIMESTAMPTZ,
  -- ESPN publishes a placeholder date before a slot is flexed or announced.
  kickoff_tbd      BOOLEAN NOT NULL DEFAULT FALSE,
  status           TEXT NOT NULL DEFAULT 'scheduled',
  home_score       INTEGER,
  away_score       INTEGER,
  spread           NUMERIC(4, 1),
  over_under       NUMERIC(4, 1),
  odds_provider    TEXT,
  odds_updated_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (season, season_type, week, home_team_id, away_team_id)
);

CREATE INDEX IF NOT EXISTS games_week_idx ON games (season, season_type, week);
CREATE INDEX IF NOT EXISTS games_kickoff_idx ON games (kickoff_at);

-- One row per user per game: who wins, and roughly by how much.
--
-- The margin is a bucket (lib/margin.ts) rather than an exact score. Entering
-- two numbers for 272 games is far more work than anyone will actually do,
-- and the exact digits never mattered: everything downstream reads only the
-- MARGIN between the two scores. It is not scored on the leaderboard either
-- -- it exists so the predicted season has point differentials, which the
-- league's tiebreaking procedure needs from "net points in common games"
-- onward.
--
-- Point spreads live on `games` and are displayed beside a game as context.
-- Nothing is picked or graded against them, so no line is copied here.
CREATE TABLE IF NOT EXISTS predictions (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id         INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  winner_team_id  INTEGER NOT NULL REFERENCES teams(id),
  margin_bucket   SMALLINT NOT NULL CHECK (margin_bucket BETWEEN 0 AND 3),
  -- TRUE when "Fill week" put this pick in rather than the user choosing it.
  -- Without the flag a default and a decision are identical rows, so "clear
  -- my week" cannot tell which picks were actually made.
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, game_id)
);

-- Where the game is played. Only really needed for the neutral-site games --
-- the nine international fixtures and the Super Bowl -- where "at Jacksonville"
-- would be actively wrong, but stored for every game since ESPN returns it
-- anyway and a home stadium name is useful on its own.
ALTER TABLE games ADD COLUMN IF NOT EXISTS venue_name TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS venue_location TEXT;

-- Against-the-spread picking was built and then dropped: the pool picks
-- winners only, with the line shown purely as context. Dropped rather than
-- left in place unused, so nothing later mistakes a dead column for a
-- feature. Guarded so this file stays re-runnable against a fresh database
-- where the columns were never created.
ALTER TABLE predictions DROP COLUMN IF EXISTS ats_team_id;
ALTER TABLE predictions DROP COLUMN IF EXISTS spread_at_pick;

CREATE INDEX IF NOT EXISTS predictions_user_idx ON predictions (user_id);

-- A week counts toward the season-long views only once explicitly submitted
-- (every game in it must have a pick first). Editing a pick in an already
-- submitted week deletes its row here, so a change cannot leak into derived
-- standings until the user resubmits.
CREATE TABLE IF NOT EXISTS week_submissions (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season        INTEGER NOT NULL,
  week          INTEGER NOT NULL,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, season, week)
);

-- Records that the automatic "fill settled games" pass has run for a week,
-- so it runs once rather than on every page load. Deliberately NOT removed
-- when a week is cleared -- that is exactly what makes a clear stick instead
-- of being undone by the next render.
CREATE TABLE IF NOT EXISTS week_default_fills (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season      INTEGER NOT NULL,
  week        INTEGER NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, season, week)
);

-- The user's postseason picks. `slot` names a game in the fixed 14-team
-- bracket tree (lib/bracket.ts BracketSlot) -- e.g. 'afc_wc_2v7',
-- 'nfc_div_1', 'super_bowl'. Saving a slot deletes every pick downstream of
-- it, so changing an earlier round cannot leave a now-impossible matchup
-- standing in a later one.
CREATE TABLE IF NOT EXISTS bracket_picks (
  season      INTEGER NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot        TEXT NOT NULL,
  team_id     INTEGER NOT NULL REFERENCES teams(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season, user_id, slot)
);

-- Frozen, tiebreaker-resolved division and conference orders, computed once
-- per user rather than on every page view. The real NFL procedure (see
-- lib/tiebreakers.ts) only means something against a complete season, so
-- this is written once the user has submitted all 18 weeks, and cleared if a
-- later edit un-submits any of them.
-- `scope` is 'division' (key = 'AFC East') or 'conference' (key = 'AFC').
CREATE TABLE IF NOT EXISTS final_standings (
  season       INTEGER NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope        TEXT NOT NULL CHECK (scope IN ('division', 'conference')),
  key          TEXT NOT NULL,
  team_ids     INTEGER[] NOT NULL,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season, user_id, scope, key)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id             SERIAL PRIMARY KEY,
  run_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  weeks_checked  INTEGER[],
  games_updated  INTEGER NOT NULL DEFAULT 0,
  odds_updated   INTEGER NOT NULL DEFAULT 0,
  error          TEXT
);

-- Real postseason ground truth, entered by the admin as it becomes known.
-- Used only for the leaderboard's end-of-season bonus; never shown as a game
-- anyone picks. 'field' holds the real 14 playoff teams; the round keys hold
-- whoever advanced INTO that round.
CREATE TABLE IF NOT EXISTS real_playoff_rounds (
  season      INTEGER NOT NULL,
  round       TEXT NOT NULL CHECK (round IN ('field', 'divisional', 'conference', 'super_bowl')),
  team_ids    INTEGER[] NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season, round)
);

CREATE TABLE IF NOT EXISTS real_champion (
  season      INTEGER PRIMARY KEY,
  team_id     INTEGER NOT NULL REFERENCES teams(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Weekly pick reminders. Opt-out lives on the user; email_sends is the
-- at-most-once ledger, so a cron that retries after a partial failure can
-- never mail the same person about the same week twice.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_reminders BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT UNIQUE;

CREATE TABLE IF NOT EXISTS email_sends (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season     INTEGER NOT NULL,
  week       INTEGER NOT NULL,
  -- 'nudge' (a couple of days out) or 'last_call' (final run before lock).
  kind       TEXT NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Null on success; the provider's message for a failed attempt.
  error      TEXT,
  UNIQUE (user_id, season, week, kind)
);
