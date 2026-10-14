import { and, desc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import { entry, item, profile, recommendation } from "@/db/schema";
import { areFriends, listFriends, type Person } from "./friends";
import { addEntry } from "./library";
import { notify } from "./notifications";

export const MAX_NOTE = 200;

export type Candidate = { person: Person; /** Already sent this one; shown, not selectable. */ alreadySent: boolean };

/**
 * Friends the item can be recommended to. A friend who already has it visibly in their list is left out.
 * One who hid it is not (that would reveal a hidden entry), so they may still be offered it.
 */
export async function friendsToRecommendTo(userId: string, itemId: string): Promise<Candidate[]> {
  const friends = await listFriends(userId);
  if (!friends.length) return [];
  const ids = friends.map((f) => f.userId);
  const [have, sent] = await Promise.all([
    db.select({ userId: entry.userId }).from(entry).where(and(inArray(entry.userId, ids), eq(entry.itemId, itemId), eq(entry.hidden, false))),
    db.select({ userId: recommendation.toUser }).from(recommendation).where(and(eq(recommendation.fromUser, userId), eq(recommendation.itemId, itemId), inArray(recommendation.toUser, ids))),
  ]);
  const haveSet = new Set(have.map((h) => h.userId));
  const sentSet = new Set(sent.map((s) => s.userId));
  return friends.filter((f) => !haveSet.has(f.userId)).map((f) => ({ person: f, alreadySent: sentSet.has(f.userId) }));
}

export type SendResult = { ok: true; sent: number } | { ok: false; error: string };

/** Recommends an item from the sender's own, not hidden, library to some of their friends. */
export async function recommend(fromId: string, itemId: string, toIds: string[], noteInput?: string | null): Promise<SendResult> {
  const note = noteInput?.trim().slice(0, MAX_NOTE) || null;
  const [mine] = await db
    .select({ hidden: entry.hidden, title: item.title })
    .from(entry)
    .innerJoin(item, eq(entry.itemId, item.id))
    .where(and(eq(entry.userId, fromId), eq(entry.itemId, itemId)));
  if (!mine) return { ok: false, error: "That is not in your library." };
  if (mine.hidden) return { ok: false, error: "That is hidden from friends. Show it to friends first." };

  const wanted = [...new Set(toIds)].filter((id) => id !== fromId);
  if (!wanted.length) return { ok: false, error: "Pick at least one friend." };
  const allowed = new Set((await friendsToRecommendTo(fromId, itemId)).filter((c) => !c.alreadySent).map((c) => c.person.userId));
  const targets = wanted.filter((id) => allowed.has(id));
  if (!targets.length) return { ok: false, error: "Nothing to send: they are not friends, already have it, or you already sent it." };

  const [me] = await db.select({ name: profile.displayName }).from(profile).where(eq(profile.userId, fromId));
  const created = await db
    .insert(recommendation)
    .values(targets.map((toUser) => ({ fromUser: fromId, toUser, itemId, note })))
    .onConflictDoNothing()
    .returning({ toUser: recommendation.toUser });
  await Promise.all(
    created.map((r) => notify({ userId: r.toUser, type: "recommendation", title: `${me?.name ?? "A friend"} recommends ${mine.title}`, body: note, url: "/friends" })),
  );
  return { ok: true, sent: created.length };
}

export type Received = {
  id: string;
  note: string | null;
  createdAt: Date;
  from: Person;
  item: typeof item.$inferSelect;
};

/** What friends have recommended and the person has not answered, newest first. Anything they have added on their own since is dropped. */
export async function listReceived(userId: string): Promise<Received[]> {
  const rows = await db
    .select({
      id: recommendation.id,
      note: recommendation.note,
      createdAt: recommendation.createdAt,
      from: { userId: profile.userId, username: profile.username, displayName: profile.displayName, avatarTone: profile.avatarTone },
      item,
    })
    .from(recommendation)
    .innerJoin(item, eq(recommendation.itemId, item.id))
    .innerJoin(profile, eq(recommendation.fromUser, profile.userId))
    .where(
      and(
        eq(recommendation.toUser, userId),
        isNull(recommendation.respondedAt),
        notExists(db.select({ one: sql`1` }).from(entry).where(and(eq(entry.userId, userId), eq(entry.itemId, recommendation.itemId)))),
      ),
    )
    .orderBy(desc(recommendation.createdAt));
  // A recommendation from someone who is no longer a friend goes quiet.
  const friendIds = new Set((await listFriends(userId)).map((f) => f.userId));
  return rows.filter((r) => friendIds.has(r.from.userId));
}

async function ownPending(userId: string, id: string) {
  const [r] = await db
    .select()
    .from(recommendation)
    .where(and(eq(recommendation.id, id), eq(recommendation.toUser, userId), isNull(recommendation.respondedAt)));
  return r ?? null;
}

/** Adds the recommended item to the recipient's list as "Want to". */
export async function acceptRecommendation(userId: string, id: string): Promise<{ entryId: string } | null> {
  const r = await ownPending(userId, id);
  if (!r || !(await areFriends(userId, r.fromUser))) return null;
  const { entry: e } = await addEntry(userId, r.itemId);
  await db.update(recommendation).set({ respondedAt: new Date() }).where(eq(recommendation.id, id));
  return { entryId: e.id };
}

export async function dismissRecommendation(userId: string, id: string): Promise<boolean> {
  const r = await ownPending(userId, id);
  if (!r) return false;
  await db.update(recommendation).set({ respondedAt: new Date() }).where(eq(recommendation.id, id));
  return true;
}
