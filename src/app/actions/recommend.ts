"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getOwnEntry } from "@/lib/entries";
import { acceptRecommendation, dismissRecommendation, MAX_NOTE, recommend } from "@/lib/recommendations";
import { requireUser } from "@/lib/session";

type Form = { message?: string; error?: string };
const uuid = z.uuid();

/** Sends the item behind one of the person's own library entries to the friends they ticked. */
export async function sendRecommendation(entryId: string, _prev: Form | undefined, formData: FormData): Promise<Form> {
  const { user } = await requireUser();
  if (!uuid.safeParse(entryId).success) return { error: "That item is not in your library." };
  const row = await getOwnEntry(user.id, entryId);
  if (!row) return { error: "That item is not in your library." };
  const to = formData.getAll("friend").map(String).filter((v) => v.length > 0 && v.length <= 64);
  const note = z.string().max(MAX_NOTE).safeParse(formData.get("note") ?? "");
  if (!note.success) return { error: `Keep the note under ${MAX_NOTE} characters.` };
  const res = await recommend(user.id, row.item.id, to, note.data);
  if (!res.ok) return { error: res.error };
  revalidatePath(`/item/${entryId}/recommend`);
  return { message: res.sent === 1 ? "Sent to 1 friend." : `Sent to ${res.sent} friends.` };
}

export async function addRecommended(id: string) {
  const { user } = await requireUser();
  if (uuid.safeParse(id).success) {
    const res = await acceptRecommendation(user.id, id);
    revalidatePath("/friends");
    revalidatePath("/library");
    revalidatePath("/");
    if (res) redirect(`/item/${res.entryId}`);
  }
}

export async function dismissRecommended(id: string) {
  const { user } = await requireUser();
  if (uuid.safeParse(id).success) await dismissRecommendation(user.id, id);
  revalidatePath("/friends");
}
