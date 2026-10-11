"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { profile } from "@/db/schema";
import { isPushEndpoint, pushConfigured, removeSubscription, saveSubscription, sendToUser } from "@/lib/push";
import { requireUser } from "@/lib/session";

const subSchema = z.object({
  endpoint: z.url().max(1000).startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }),
});

export async function savePushSubscription(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireUser();
  const parsed = subSchema.safeParse(input);
  if (!parsed.success || !isPushEndpoint(parsed.data.endpoint)) return { ok: false, error: "That device could not be registered." };
  const saved = await saveSubscription(user.id, { endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth });
  if (!saved) return { ok: false, error: "You have reminders on for too many devices. Turn some off first." };
  revalidatePath("/settings");
  return { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<{ ok: boolean }> {
  const { user } = await requireUser();
  if (typeof endpoint === "string" && endpoint.length < 1000) await removeSubscription(user.id, endpoint);
  revalidatePath("/settings");
  return { ok: true };
}

export async function saveReminderLead(minutes: number): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireUser();
  const parsed = z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(60)]).safeParse(minutes);
  if (!parsed.success) return { ok: false, error: "Pick off, 15, 30 or 60 minutes." };
  await db.update(profile).set({ reminderLeadMin: parsed.data }).where(eq(profile.userId, user.id));
  revalidatePath("/settings");
  return { ok: true };
}

export async function sendTestReminder(): Promise<{ ok: boolean; message: string }> {
  const { user } = await requireUser();
  if (!pushConfigured()) return { ok: false, message: "Reminders are not set up on this server yet." };
  const res = await sendToUser(user.id, { title: "Cheese reminders work", body: "You will get one of these before each session.", url: "/plan", tag: "test" });
  return res.sent > 0 ? { ok: true, message: "Sent. It should arrive in a moment." } : { ok: false, message: "No device received it. Turn reminders on again on this device." };
}
