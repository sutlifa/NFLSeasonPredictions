export const metadata = { title: "Privacy · NFL Predictions" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 text-sm leading-relaxed text-ink-soft">
      <h1 className="text-2xl font-bold text-ink">Privacy</h1>
      <h2 className="pt-2 text-lg font-bold text-ink">What is stored</h2>
      <p>
        Signing in with Google stores your Google account id, email address,
        display name and profile picture URL. That is the whole of it — no
        password is involved, and nothing else from your Google account is
        requested or kept.
      </p>
      <p>
        Alongside that, the site stores the picks you make and the bracket you
        build.
      </p>
      <h2 className="pt-2 text-lg font-bold text-ink">Who can see it</h2>
      <p>
        Your display name, your points and your win-loss records appear on the
        leaderboard, which every signed-in member of the pool can see. Your
        email address is never shown to other members.
      </p>
      <h2 className="pt-2 text-lg font-bold text-ink">Sharing</h2>
      <p>
        Nothing is sold, shared with advertisers, or sent to any third party.
        There is no analytics or tracking code on this site.
      </p>
      <h2 className="pt-2 text-lg font-bold text-ink">Deleting your data</h2>
      <p>
        Ask the site owner and your account and every pick attached to it will
        be deleted outright.
      </p>
    </div>
  );
}
