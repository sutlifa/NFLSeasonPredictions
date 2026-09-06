import Link from "next/link";
import { TOTAL_WEEKS } from "@/lib/nfl";

type Props = {
  week: number;
};

/**
 * Previous/next week arrows pinned to the edges of the viewport, so a week
 * can be changed from anywhere down a long page of games rather than only
 * from the strip at the top.
 *
 * `fixed` rather than `sticky`: sticky would still scroll away with its
 * container once the list ran out, which is exactly the bottom of the page
 * where the arrows are most useful.
 *
 * They float over the content on purpose. The page is max-w-6xl and centred,
 * so there is only a real gutter to sit in on wide screens -- on anything
 * narrower these overlap the edge of a card. Translucent with a blur and a
 * border, they read as floating chrome rather than as part of the card
 * underneath, which is the same bargain a carousel's arrows make.
 *
 * The arrow at each end of the season is simply absent rather than present
 * and disabled: nothing moves when it disappears (these are fixed), and a
 * dead control invites clicking.
 */
export function WeekPager({ week }: Props) {
  const previous = week > 1 ? week - 1 : null;
  const next = week < TOTAL_WEEKS ? week + 1 : null;

  const base =
    "fixed top-1/2 z-30 flex -translate-y-1/2 flex-col items-center justify-center gap-0.5 " +
    "rounded-lg border border-line-strong/80 bg-surface/85 px-1.5 py-3 text-ink-soft " +
    "shadow-lg backdrop-blur-sm transition-colors hover:border-accent hover:bg-surface " +
    "hover:text-ink sm:px-2 sm:py-4";

  return (
    <>
      {previous !== null && (
        <Link
          href={`/picks/${previous}`}
          aria-label={`Go to week ${previous}`}
          className={`${base} left-1 sm:left-2`}
        >
          <span aria-hidden className="text-lg leading-none">
            ‹
          </span>
          <span className="tabular text-[10px] font-semibold leading-none">
            {previous}
          </span>
        </Link>
      )}

      {next !== null && (
        <Link
          href={`/picks/${next}`}
          aria-label={`Go to week ${next}`}
          className={`${base} right-1 sm:right-2`}
        >
          <span aria-hidden className="text-lg leading-none">
            ›
          </span>
          <span className="tabular text-[10px] font-semibold leading-none">
            {next}
          </span>
        </Link>
      )}
    </>
  );
}
