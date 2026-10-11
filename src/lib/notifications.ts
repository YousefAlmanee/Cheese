import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { notification } from "@/db/schema";
import { sendToUser } from "./push";

export type NotificationRow = typeof notification.$inferSelect;

export type NewNotification = {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  url?: string | null;
};

/**
 * Records an in-app notification and, if the person has push turned on, sends it to their devices too.
 * Never throws into the caller's flow: a notification is a side effect, not part of the main action.
 */
export async function notify(n: NewNotification): Promise<void> {
  try {
    await db.insert(notification).values({ userId: n.userId, type: n.type, title: n.title, body: n.body ?? null, url: n.url ?? null });
    // Push is best-effort; failures (no subscription, dead endpoint) are already handled inside sendToUser.
    await sendToUser(n.userId, { title: n.title, body: n.body ?? undefined, url: n.url ?? undefined, tag: n.type });
  } catch {
    // Swallow: the user's action must still succeed even if we could not notify someone.
  }
}

/** Notifies several people of the same thing (e.g. everyone invited to a night). */
export async function notifyMany(userIds: string[], n: Omit<NewNotification, "userId">): Promise<void> {
  await Promise.all(userIds.map((userId) => notify({ ...n, userId })));
}

export async function listNotifications(userId: string, limit = 40): Promise<NotificationRow[]> {
  return db.select().from(notification).where(eq(notification.userId, userId)).orderBy(desc(notification.createdAt)).limit(limit);
}

export async function unreadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notification)
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)));
  return row?.n ?? 0;
}

export async function markAllRead(userId: string): Promise<void> {
  await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)));
}
