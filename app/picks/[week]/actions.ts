"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { isMarginBucketId } from "@/lib/margin";
import { clearWeek, savePick, submitWeek, getWeekGames } from "@/lib/queries";
import { isLocked } from "@/lib/queries";

async function requireUserId(): Promise<number> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  return session.user.id;
}

/**
 * Everything a changed pick feeds. A pick moves the standings, the standings
 * decide the playoff seeds, and the seeds lay out the bracket -- so a change
 * has to be carried all the way down, or the bracket keeps showing the field
 * the old picks produced.
 */
function revalidateAllAffected(week: number) {
  revalidatePath(`/picks/${week}`);
  revalidatePath("/picks");
  revalidatePath("/standings");
  revalidatePath("/playoffs");
  revalidatePath("/leaderboard");
  // Both clubs in the game have a season page showing this pick. The pick
  // does not say which, so revalidate the whole segment.
  revalidatePath("/teams/[teamId]", "page");
  revalidatePath("/");
}

/**
 * A week submits itself once every game in it has a pick, so there is no
 * separate button to remember. Editing a game in an already-submitted week
 * un-submits it (in savePick) and then re-submits here if it is still
 * complete -- so a single edit does not silently drop the week out of the
 * derived standings.
 */
async function settleWeek(userId: number, week: number) {
  const games = await getWeekGames(userId, week);
  const complete =
    games.length > 0 &&
    games.every((game) => game.predictedWinnerTeamId !== null);
  if (complete) await submitWeek(userId, week);
  revalidateAllAffected(week);
}

export async function savePickAction(formData: FormData) {
  const userId = await requireUserId();
  const gameId = Number(formData.get("gameId"));
  const week = Number(formData.get("week"));
  const winnerTeamId = Number(formData.get("winnerTeamId"));
  const marginBucket = Number(formData.get("marginBucket"));

  if (!Number.isInteger(gameId) || !Number.isInteger(winnerTeamId)) {
    throw new Error("Invalid pick");
  }
  if (!isMarginBucketId(marginBucket)) {
    throw new Error("Pick how big the margin will be.");
  }

  await savePick(userId, { gameId, winnerTeamId, marginBucket });
  await settleWeek(userId, week);
}

/**
 * Wipe a week. The kickoff lock lives in clearWeek, not here, so a stale
 * page or a hand-rolled post cannot get round it either.
 */
export async function clearWeekAction(formData: FormData) {
  const userId = await requireUserId();
  const week = Number(formData.get("week"));
  if (!Number.isInteger(week)) throw new Error("Invalid week");

  await clearWeek(userId, week);
  revalidateAllAffected(week);
}

/**
 * Fill every unpicked game in the week with the side the market favours, and
 * a margin matching the size of that line.
 *
 * The favourite is read from the posted spread, not from a rating of our
 * own: the line already is the market's opinion, and inventing a second,
 * worse opinion to default from would be strictly less useful. This is the
 * one place the spread still drives anything -- it is otherwise shown purely
 * as context.
 *
 * A game with no line yet is left alone rather than guessed at; there is
 * nothing to base a default on, and quietly picking the home side would look
 * like a real pick. A pick'em is skipped for the same reason.
 *
 * Adds only. An existing pick is never overwritten, so this cannot undo a
 * decision someone already made.
 */
export async function fillWeekAction(formData: FormData) {
  const userId = await requireUserId();
  const week = Number(formData.get("week"));
  if (!Number.isInteger(week)) throw new Error("Invalid week");

  const games = await getWeekGames(userId, week);
  for (const game of games) {
    if (game.predictedWinnerTeamId !== null) continue;
    if (isLocked(game)) continue;
    if (game.spread === null) continue;

    // A pick'em has no favourite to default to; leave it for the user.
    if (game.spread === 0) continue;
    const favourite =
      game.spread < 0 ? game.homeTeamId : game.awayTeamId;
    const margin = Math.abs(game.spread);
    const bucket = margin <= 3 ? 0 : margin <= 7 ? 1 : margin <= 14 ? 2 : 3;

    await savePick(userId, {
      gameId: game.id,
      winnerTeamId: favourite,
      marginBucket: bucket,
      isDefault: true,
    });
  }
  await settleWeek(userId, week);
}
