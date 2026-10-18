"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CATEGORIES, SOURCES, STATUSES } from "@/db/schema";
import { changeStatus, setTogetherMany } from "@/lib/entries";
import { addFromRef, addManual } from "@/lib/library";
import { safeNext } from "@/lib/safe-next";
import { requireUser } from "@/lib/session";

const refSchema = z.object({
  source: z.enum(SOURCES).exclude(["manual"]),
  externalId: z.string().min(1).max(40),
  category: z.enum(CATEGORIES),
});

export type AddResult = { ok: true; entryId: string } | { ok: false; error: string };

export async function addToLibrary(input: unknown): Promise<AddResult> {
  const { user } = await requireUser();
  const ref = refSchema.safeParse(input);
  if (!ref.success) return { ok: false, error: "That item could not be read." };
  try {
    const { entryId } = await addFromRef(user.id, ref.data);
    revalidatePath("/library");
    revalidatePath("/");
    return { ok: true, entryId };
  } catch {
    return { ok: false, error: "Could not reach the source for that item. Try again in a moment." };
  }
}

/** The quick "Watched / Read / Played" button in search: adds the title if needed and marks it finished, without leaving the page. */
export async function addAsDone(input: unknown): Promise<AddResult> {
  const { user } = await requireUser();
  const ref = refSchema.safeParse(input);
  if (!ref.success) return { ok: false, error: "That item could not be read." };
  try {
    const { entryId } = await addFromRef(user.id, ref.data);
    await changeStatus(user.id, entryId, "done");
    revalidatePath("/library");
    revalidatePath("/");
    return { ok: true, entryId };
  } catch {
    return { ok: false, error: "Could not reach the source for that item. Try again in a moment." };
  }
}

/** Adds a title from its details page and sets where it stands in one go: "want", "in progress" or "done". */
export async function addWithStatus(input: unknown, status: string): Promise<{ ok: false; error: string }> {
  const { user } = await requireUser();
  const ref = refSchema.safeParse(input);
  const st = z.enum(STATUSES).safeParse(status);
  if (!ref.success || !st.success) return { ok: false, error: "That item could not be read." };
  let entryId: string;
  try {
    ({ entryId } = await addFromRef(user.id, ref.data));
    if (st.data !== "want") await changeStatus(user.id, entryId, st.data);
  } catch {
    return { ok: false, error: "Could not reach the source for that item. Try again in a moment." };
  }
  revalidatePath("/library");
  revalidatePath("/");
  redirect(`/item/${entryId}${st.data === "done" ? "?rate=1" : ""}`);
}

const num = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).max(100000).nullable());

const manualSchema = z.object({
  category: z.enum(CATEGORIES),
  title: z.string().trim().min(1, "Give it a title.").max(200),
  creator: z.string().trim().max(120).optional(),
  count: num,
  minutes: num,
  hours: num,
});

export async function addManualItem(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const { user } = await requireUser();
  const parsed = manualSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { entryId } = await addManual(user.id, parsed.data);
  revalidatePath("/library");
  revalidatePath("/");
  redirect(`/item/${entryId}`);
}

const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  together: z.enum(["1", "0"]),
});

/** Library "Select" mode: marks every ticked item as together (or not together), then returns to the same view. */
export async function bulkTogether(formData: FormData) {
  const { user } = await requireUser();
  const parsed = bulkSchema.safeParse({ ids: formData.getAll("id").map(String), together: formData.get("together") });
  const back = safeNext(String(formData.get("back") ?? ""));
  if (parsed.success) await setTogetherMany(user.id, parsed.data.ids, parsed.data.together === "1");
  revalidatePath("/library");
  revalidatePath("/friends");
  redirect(back.startsWith("/library") ? back : "/library");
}
