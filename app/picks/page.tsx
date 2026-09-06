import { redirect } from "next/navigation";
import { getCurrentWeek } from "@/lib/queries";

// "Picks" in the nav should land on the week people actually need to pick,
// not week 1 in December. getCurrentWeek returns the earliest week that
// still has a game ahead of it.
export default async function PicksIndex() {
  const week = await getCurrentWeek();
  redirect(`/picks/${week}`);
}
