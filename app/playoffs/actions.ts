"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { ALL_SLOTS, type BracketSlot } from "@/lib/playoffs";
import { clearBracket, saveBracketPick } from "@/lib/queries";

async function requireUserId(): Promise<number> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  return session.user.id;
}

export async function pickBracketAction(formData: FormData) {
  const userId = await requireUserId();
  const slot = String(formData.get("slot") ?? "");
  const teamId = Number(formData.get("teamId"));

  // The slot names a position in a fixed tree, so it can be checked against
  // the known set rather than trusted -- an unknown slot would otherwise sit
  // in the table forever, invisible to the bracket that renders it.
  if (!ALL_SLOTS.includes(slot as BracketSlot)) {
    throw new Error("Unknown bracket slot");
  }
  if (!Number.isInteger(teamId)) throw new Error("Invalid team");

  await saveBracketPick(userId, slot as BracketSlot, teamId);
  revalidatePath("/playoffs");
  revalidatePath("/");
}

export async function clearBracketAction() {
  const userId = await requireUserId();
  await clearBracket(userId);
  revalidatePath("/playoffs");
  revalidatePath("/");
}
