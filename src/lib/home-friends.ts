import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { entry, item, type Category, type Status } from "@/db/schema";
import { listFriends, type Person } from "./friends";

export type SharedItem = {
  /** The viewer's own entry, so a tap opens their copy of the item. */
  entryId: string;
  title: string;
  category: Category;
  coverUrl: string | null;
  myStatus: Status;
  friendStatus: Status;
};

export type FriendShelf = { friend: Person; items: SharedItem[] };

export type FriendShelves = {
  friendCount: number;
  /** Only friends with at least one item in common (after the category filter). */
  shelves: FriendShelf[];
};

/**
 * One shelf per friend: the items both people have in their library. Anything either side
 * has marked "show to friends" off is left out, so a hidden entry never surfaces here.
 */
export async function loadFriendShelves(userId: string, category?: Category): Promise<FriendShelves> {
  const friends = await listFriends(userId);
  if (!friends.length) return { friendCount: 0, shelves: [] };

  const theirs = alias(entry, "their_entry");
  const rows = await db
    .select({
      friendId: theirs.userId,
      entryId: entry.id,
      title: item.title,
      category: item.category,
      coverUrl: item.coverUrl,
      myStatus: entry.status,
      friendStatus: theirs.status,
    })
    .from(entry)
    .innerJoin(theirs, eq(theirs.itemId, entry.itemId))
    .innerJoin(item, eq(item.id, entry.itemId))
    .where(
      and(
        eq(entry.userId, userId),
        eq(entry.hidden, false),
        inArray(theirs.userId, friends.map((f) => f.userId)),
        eq(theirs.hidden, false),
        category ? eq(item.category, category) : undefined,
      ),
    )
    .orderBy(sql`${entry.updatedAt} desc`, item.title);

  const byFriend = new Map<string, SharedItem[]>();
  for (const { friendId, ...shared } of rows) {
    const list = byFriend.get(friendId) ?? [];
    list.push(shared);
    byFriend.set(friendId, list);
  }
  const shelves = friends
    .filter((f) => byFriend.has(f.userId))
    .map((friend) => ({ friend, items: byFriend.get(friend.userId)! }))
    // The friend you share the most with comes first; ties keep the A to Z order of listFriends.
    .sort((a, b) => b.items.length - a.items.length);
  return { friendCount: friends.length, shelves };
}
