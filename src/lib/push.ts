import { and, eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/db";
import { pushSubscription } from "@/db/schema";

export type PushPayload = { title: string; body?: string; url?: string; tag?: string };

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let configured = false;
function configure() {
  if (configured) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@example.com", process.env.VAPID_PUBLIC_KEY as string, process.env.VAPID_PRIVATE_KEY as string);
  configured = true;
}

export async function saveSubscription(userId: string, sub: { endpoint: string; p256dh: string; auth: string }) {
  await db
    .insert(pushSubscription)
    .values({ userId, ...sub })
    .onConflictDoUpdate({ target: pushSubscription.endpoint, set: { userId, p256dh: sub.p256dh, auth: sub.auth } });
}

export async function removeSubscription(userId: string, endpoint: string) {
  await db.delete(pushSubscription).where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.endpoint, endpoint)));
}

export async function subscriptionCount(userId: string): Promise<number> {
  return (await db.select({ id: pushSubscription.id }).from(pushSubscription).where(eq(pushSubscription.userId, userId))).length;
}

/** Sends to every device the person has turned reminders on for. Devices that are gone are forgotten. */
export async function sendToUser(userId: string, payload: PushPayload): Promise<{ sent: number; removed: number }> {
  if (!pushConfigured()) return { sent: 0, removed: 0 };
  configure();
  const subs = await db.select().from(pushSubscription).where(eq(pushSubscription.userId, userId));
  let sent = 0;
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(s.id);
        else console.error(`push to device ${s.id} failed`, status ?? e);
      }
    }),
  );
  if (dead.length) await db.delete(pushSubscription).where(inArray(pushSubscription.id, dead));
  return { sent, removed: dead.length };
}
