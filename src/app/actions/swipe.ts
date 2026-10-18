"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { resetMine, swipe } from "@/lib/swipe";

const uuid = z.uuid();

export async function answerSwipe(groupId: string, itemId: string, liked: boolean): Promise<{ ok: true; unanimous: boolean } | { ok: false; error: string }> {
  const { user } = await requireUser();
  if (!uuid.safeParse(groupId).success || !uuid.safeParse(itemId).success || typeof liked !== "boolean") return { ok: false, error: "That could not be saved." };
  return swipe(user.id, groupId, itemId, liked);
}

export async function startOver(groupId: string) {
  const { user } = await requireUser();
  if (uuid.safeParse(groupId).success) await resetMine(user.id, groupId);
  revalidatePath(`/friends/group/${groupId}/swipe`);
}
