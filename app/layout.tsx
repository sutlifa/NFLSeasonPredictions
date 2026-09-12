import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import { MobileNav } from "@/components/MobileNav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NFL Season Predictions",
  description:
    "Pick every game — who wins and by how much — then see your season play out through real NFL standings and the playoff bracket.",
};

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/picks", label: "Picks" },
  { href: "/standings", label: "Standings" },
  { href: "/playoffs", label: "Playoffs" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/teams", label: "Teams" },
];

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-field text-ink">
        {/* `relative` anchors the mobile menu panel, which drops out of the
            header with `absolute inset-x-0 top-full`. */}
        <header className="relative border-b-2 border-accent bg-surface shadow-[0_2px_14px_rgba(0,0,0,0.5)]">
          <nav className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-3 text-sm">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2 text-base font-bold tracking-wide text-ink"
            >
              {/* Plain <img> rather than next/image -- a fixed-size static
                  SVG has nothing to optimise. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-mark.svg" alt="" width={24} height={24} className="shrink-0" />
              <span>
                NFL <span className="text-accent-strong">Predictions</span>
              </span>
            </Link>

            {/* Inline nav is `md` and up only -- below that these links and
                the sign-out button live in the folding menu instead of
                wrapping onto three cramped lines. */}
            {session?.user && (
              <div className="hidden gap-1 md:flex md:flex-wrap">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded px-2.5 py-1.5 font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            )}

            {session?.user && (
              <div className="ml-auto hidden items-center gap-3 md:flex">
                <span className="text-ink-muted">
                  {session.user.name ?? session.user.email}
                </span>
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/signin" });
                  }}
                >
                  <button
                    type="submit"
                    className="rounded border border-line-strong px-2.5 py-1 text-xs text-ink-soft hover:border-accent hover:text-ink"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            )}

            {session?.user && (
              <div className="ml-auto md:hidden">
                <MobileNav
                  links={NAV_LINKS}
                  userLabel={session.user.name ?? session.user.email ?? ""}
                  signOutAction={async () => {
                    "use server";
                    await signOut({ redirectTo: "/signin" });
                  }}
                />
              </div>
            )}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          {children}
        </main>

        <footer className="mx-auto w-full max-w-6xl space-y-1 px-4 py-5 text-center text-xs text-ink-muted">
          <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <Link href="/about" className="hover:text-ink-soft">
              About
            </Link>
            <span aria-hidden>&middot;</span>
            <Link href="/privacy" className="hover:text-ink-soft">
              Privacy
            </Link>
            <span aria-hidden>&middot;</span>
            {/* The sister app. A plain <a>, not <Link>: it is a different
                origin, so there is no route for Next to prefetch. Same tab
                on purpose -- it is one of ours, not an outbound citation,
                and back returns you here.

                The URL is hardcoded because it is the college app's
                production origin. If that ever moves to a custom domain,
                this is one of the places that has to move with it. */}
            <a
              href="https://college-football-predictions.vercel.app/"
              className="hover:text-ink-soft"
            >
              CFB Predictions
            </a>
          </p>
          <p>&copy; {new Date().getFullYear()} Sutlifa. All rights reserved.</p>
          <p className="text-[11px] leading-relaxed">
            Not affiliated with or endorsed by the National Football League.
            Team names and logos are trademarks of their respective owners.
            Point spreads are shown for reference only.
          </p>
        </footer>
      </body>
    </html>
  );
}
