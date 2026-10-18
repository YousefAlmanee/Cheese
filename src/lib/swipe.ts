import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { groupSwipe } from "@/db/schema";
import { loadGroupView, type CommonRow } from "./common";
import type { Person } from "./friends";
import { notifyMany } from "./notifications";

export type Deck = {
  groupId: string;
  groupName: string;
  members: Person[];
  /** Items the viewer has not swiped yet, in the group's usual order. */
  todo: CommonRow[];
  /** How many items are in the whole deck. */
  total: number;
};

export type Result = {
  row: CommonRow;
  /** People who said yes. Nobody's "no" is shown by name. */
  yes: Person[];
  /** How many members have answered, one way or the other. */
  answered: number;
  everyone: boolean;
};

/** The viewer's deck: the group's common list minus what they already answered. Null if they are not in the group. */
export async function loadDeck(viewerId: string, groupId: string): Promise<Deck | null> {
  const view = await loadGroupView(viewerId, groupId);
  if (!view) return null;
  const mine = await db
    .select({ itemId: groupSwipe.itemId })
    .from(groupSwipe)
    .where(and(eq(groupSwipe.groupId, groupId), eq(groupSwipe.userId, viewerId)));
  const done = new Set(mine.map((m) => m.itemId));
  return { groupId, groupName: view.group.name, members: view.group.members, todo: view.rows.filter((r) => !done.has(r.item.id)), total: view.rows.length };
}

export type SwipeOutcome = { ok: true; unanimous: boolean } | { ok: false; error: string };

/** Records the viewer's yes or no. Answering again just changes the answer. */
export async function swipe(viewerId: string, groupId: string, itemId: string, liked: boolean): Promise<SwipeOutcome> {
  const view = await loadGroupView(viewerId, groupId);
  if (!view) return { ok: false, error: "You are not in that group." };
  // Only things the group really has in common can be swiped, so nobody can plant an item in the deck.
  const row = view.rows.find((r) => r.item.id === itemId);
  if (!row) return { ok: false, error: "That is not on the group's list any more." };
  const memberIds = view.group.members.map((m) => m.userId);

  const before = await likedBy(groupId, itemId, memberIds);
  await db
    .insert(groupSwipe)
    .values({ groupId, userId: viewerId, itemId, liked })
    .onConflictDoUpdate({ target: [groupSwipe.groupId, groupSwipe.userId, groupSwipe.itemId], set: { liked, createdAt: new Date() } });
  const after = await likedBy(groupId, itemId, memberIds);

  const everyone = memberIds.length > 1 && after.size === memberIds.length;
  // Tell people only at the moment the last yes arrives, not on every later change of mind.
  const justBecame = everyone && before.size < memberIds.length;
  if (justBecame) {
    await notifyMany(
      memberIds.filter((id) => id !== viewerId),
      { type: "swipe_match", title: `${view.group.name}: everyone wants ${row.item.title}`, body: "Time to pick a night?", url: `/friends/group/${groupId}/swipe` },
    );
  }
  return { ok: true, unanimous: everyone };
}

async function likedBy(groupId: string, itemId: string, memberIds: string[]): Promise<Set<string>> {
  const rows = await db
    .select({ userId: groupSwipe.userId })
    .from(groupSwipe)
    .where(and(eq(groupSwipe.groupId, groupId), eq(groupSwipe.itemId, itemId), eq(groupSwipe.liked, true), inArray(groupSwipe.userId, memberIds)));
  return new Set(rows.map((r) => r.userId));
}

/** Items someone said yes to, everyone-said-yes first, then by yes count. Only current members count. */
export async function loadResults(viewerId: string, groupId: string): Promise<Result[] | null> {
  const view = await loadGroupView(viewerId, groupId);
  if (!view) return null;
  const memberIds = view.group.members.map((m) => m.userId);
  const byId = new Map(view.group.members.map((m) => [m.userId, m]));
  const rows = await db.select().from(groupSwipe).where(and(eq(groupSwipe.groupId, groupId), inArray(groupSwipe.userId, memberIds)));

  const results: Result[] = [];
  for (const row of view.rows) {
    const mine = rows.filter((r) => r.itemId === row.item.id);
    const yes = mine.filter((r) => r.liked).map((r) => byId.get(r.userId)!);
    if (!yes.length) continue;
    results.push({ row, yes, answered: mine.length, everyone: memberIds.length > 1 && yes.length === memberIds.length });
  }
  // view.rows is already A to Z within equal counts, and sort is stable, so ties keep a steady order.
  return results.sort((a, b) => Number(b.everyone) - Number(a.everyone) || b.yes.length - a.yes.length);
}

/** Clears the viewer's own answers for the group so they can swipe again. Nobody else's change. */
export async function resetMine(viewerId: string, groupId: string): Promise<boolean> {
  const view = await loadGroupView(viewerId, groupId);
  if (!view) return false;
  await db.delete(groupSwipe).where(and(eq(groupSwipe.groupId, groupId), eq(groupSwipe.userId, viewerId)));
  return true;
}
