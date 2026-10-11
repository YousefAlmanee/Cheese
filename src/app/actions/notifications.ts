"use server";

import { revalidatePath } from "next/cache";
import { markAllRead } from "@/lib/notifications";
import { requireUser } from "@/lib/session";

/** Marks every notification read. Called when the notification centre is opened. */
export async function markNotificationsRead() {
  const { user } = await requireUser();
  await markAllRead(user.id);
  revalidatePath("/", "layout");
}
