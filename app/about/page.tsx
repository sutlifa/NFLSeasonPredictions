export const metadata = { title: "About · NFL Predictions" };

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 text-sm leading-relaxed text-ink-soft">
      <h1 className="text-2xl font-bold text-ink">About</h1>
      <p>
        A private pool for predicting an NFL season. Pick every game two ways —
        who wins outright, and who covers the point spread — and the leaderboard
        scores both as results come in.
      </p>
      <h2 className="pt-2 text-lg font-bold text-ink">How scoring works</h2>
      <p>
        One point for the straight-up winner, one for the spread, and half a
        point when a spread pick pushes. Spread picks are graded against the
        line as it stood when you made the pick, not the closing line, so a
        line that moves afterwards can never change what you were scored on.
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
        endpoints. Spreads are whichever book ESPN surfaces, usually DraftKings.
      </p>
      <p className="text-ink-muted">
        Not affiliated with or endorsed by the National Football League. Point
        spreads are shown for entertainment only — this is not a betting site
        and no money changes hands.
      </p>
    </div>
  );
}
