export const metadata = { title: "About · NFL Predictions" };

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 text-sm leading-relaxed text-ink-soft">
      <h1 className="text-2xl font-bold text-ink">About</h1>
      <p>
        A private pool for predicting an NFL season. Pick every game — who wins,
        and roughly by how much — and the leaderboard scores it as results come
        in.
      </p>
      <h2 className="pt-2 text-lg font-bold text-ink">How scoring works</h2>
      <p>
        One point for every game whose winner you call. The margin you attach
        to a pick is not scored — it exists so your predicted season has point
        differentials, which the league&rsquo;s tiebreaking procedure needs from
        &ldquo;net points in common games&rdquo; onward. So it does real work,
        just not on the leaderboard.
      </p>
      <p>
        Point spreads are shown beside each game as the market&rsquo;s own read,
        but nothing is picked or graded against them. Picks lock at each
        game&rsquo;s individual kickoff rather than at a weekly deadline.
      </p>
      <h2 className="pt-2 text-lg font-bold text-ink">Standings and playoffs</h2>
      <p>
        Your picks build your own version of the season. The standings pages
        apply the league&rsquo;s published tiebreaking procedure in full —
        head-to-head, division record, common games, conference record,
        strength of victory and strength of schedule, and on down — and the
        bracket seeds four division winners and three wild cards per
        conference, with the divisional round reseeded the way the real one is.
      </p>
      <p className="text-ink-muted">
        Two steps of the published procedure are not implemented, because the
        data to run them does not exist here: net touchdowns (picks record a
        margin, not a box score) and the final coin toss, which is replaced by
        a stable alphabetical order so a page does not reshuffle itself on
        every visit.
      </p>
      <h2 className="pt-2 text-lg font-bold text-ink">Where the data comes from</h2>
      <p>
        Schedules, scores, logos and point spreads come from ESPN&rsquo;s public
        endpoints. Spreads are whichever book ESPN surfaces, usually DraftKings,
        and are refreshed until kickoff.
      </p>
      <p className="text-ink-muted">
        Not affiliated with or endorsed by the National Football League. Point
        spreads are shown for reference only — this is not a betting site, and
        no money changes hands.
      </p>
    </div>
  );
}
