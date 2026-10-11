import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { entry, friendGroup, friendship, groupMember, item, profile } from "@/db/schema";
import { notify } from "./notifications";
import { isValidUsername } from "./username";

export type Person = { userId: string; username: string; displayName: string; avatarTone: number };
export type Result = { ok: true; message: string; person?: Person } | { ok: false; error: string };

const personCols = { userId: profile.userId, username: profile.username, displayName: profile.displayName, avatarTone: profile.avatarTone };

export const orderPair = (a: string, b: string) => (a < b ? { low: a, high: b } : { low: b, high: a });

export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@/, "").toLowerCase();
}

async function pairRow(a: string, b: string) {
  const { low, high } = orderPair(a, b);
  return db.query.friendship.findFirst({ where: and(eq(friendship.userLow, low), eq(friendship.userHigh, high)) });
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  return (await pairRow(a, b))?.status === "accepted";
}

async function personById(userId: string): Promise<Person | null> {
  const [p] = await db.select(personCols).from(profile).where(eq(profile.userId, userId));
  return p ?? null;
}

/** Sends a friend request by username. If they already asked you, you become friends straight away. */
export async function sendFriendRequest(userId: string, usernameInput: string): Promise<Result> {
  const username = normalizeUsername(usernameInput);
  if (!isValidUsername(username)) return { ok: false, error: "Usernames are 3 to 20 letters, numbers or underscores." };
  const [target] = await db.select(personCols).from(profile).where(eq(profile.username, username));
  if (!target) return { ok: false, error: "No one has that username." };
  if (target.userId === userId) return { ok: false, error: "That is you." };

  const me = await personById(userId);
  const myName = me?.displayName ?? "Someone";

  const existing = await pairRow(userId, target.userId);
  if (existing?.status === "accepted") return { ok: false, error: `You and ${target.displayName} are already friends.` };
  if (existing && existing.requestedBy === userId) return { ok: false, error: `You already asked ${target.displayName}. They need to accept.` };
  if (existing) {
    await db.update(friendship).set({ status: "accepted" }).where(eq(friendship.id, existing.id));
    await notify({ userId: target.userId, type: "friend_accepted", title: `${myName} accepted your friend request`, url: "/friends/people" });
    return { ok: true, message: `You and ${target.displayName} are now friends.`, person: target };
  }
  const { low, high } = orderPair(userId, target.userId);
  await db.insert(friendship).values({ userLow: low, userHigh: high, requestedBy: userId });
  await notify({ userId: target.userId, type: "friend_request", title: `${myName} sent you a friend request`, url: "/friends/people" });
  return { ok: true, message: `Asked ${target.displayName}. They will see it next time they open Cheese.`, person: target };
}

export async function respondToRequest(userId: string, otherId: string, accept: boolean): Promise<boolean> {
  const row = await pairRow(userId, otherId);
  // Only the person who was asked can answer.
  if (!row || row.status !== "pending" || row.requestedBy === userId) return false;
  if (accept) {
    await db.update(friendship).set({ status: "accepted" }).where(eq(friendship.id, row.id));
    const me = await personById(userId);
    await notify({ userId: otherId, type: "friend_accepted", title: `${me?.displayName ?? "Someone"} accepted your friend request`, url: "/friends/people" });
  } else {
    await db.delete(friendship).where(eq(friendship.id, row.id));
  }
  return true;
}

/** Ends a friendship, or cancels a request you sent. Also takes the two of you out of each other's groups' shared view only by leaving groups yourself. */
export async function removeFriend(userId: string, otherId: string): Promise<boolean> {
  const row = await pairRow(userId, otherId);
  if (!row) return false;
  if (row.status === "pending" && row.requestedBy !== userId) return false; // use respondToRequest to decline
  await db.delete(friendship).where(eq(friendship.id, row.id));
  return true;
}

/** Following someone's invite link makes you friends at once, because they shared it on purpose. */
export async function acceptInvite(userId: string, code: string): Promise<Result> {
  const [owner] = await db.select(personCols).from(profile).where(eq(profile.inviteCode, code.trim().toLowerCase()));
  if (!owner) return { ok: false, error: "That invite link is not valid any more." };
  if (owner.userId === userId) return { ok: false, error: "That is your own invite link." };
  const existing = await pairRow(userId, owner.userId);
  if (existing?.status === "accepted") return { ok: true, message: `You and ${owner.displayName} are already friends.`, person: owner };
  if (existing) {
    await db.update(friendship).set({ status: "accepted" }).where(eq(friendship.id, existing.id));
  } else {
    const { low, high } = orderPair(userId, owner.userId);
    await db.insert(friendship).values({ userLow: low, userHigh: high, requestedBy: owner.userId, status: "accepted" });
  }
  const me = await personById(userId);
  await notify({ userId: owner.userId, type: "friend_joined", title: `${me?.displayName ?? "Someone"} joined you on Cheese`, url: "/friends/people" });
  return { ok: true, message: `You and ${owner.displayName} are now friends.`, person: owner };
}

export async function inviterForCode(code: string): Promise<Person | null> {
  const [p] = await db.select(personCols).from(profile).where(eq(profile.inviteCode, code.trim().toLowerCase()));
  return p ?? null;
}

export async function listFriends(userId: string): Promise<Person[]> {
  const rows = await db
    .select({ low: friendship.userLow, high: friendship.userHigh })
    .from(friendship)
    .where(and(eq(friendship.status, "accepted"), or(eq(friendship.userLow, userId), eq(friendship.userHigh, userId))));
  const ids = rows.map((r) => (r.low === userId ? r.high : r.low));
  if (!ids.length) return [];
  return db.select(personCols).from(profile).where(inArray(profile.userId, ids)).orderBy(asc(profile.displayName));
}

export async function listRequests(userId: string): Promise<{ incoming: Person[]; outgoing: Person[] }> {
  const rows = await db
    .select()
    .from(friendship)
    .where(and(eq(friendship.status, "pending"), or(eq(friendship.userLow, userId), eq(friendship.userHigh, userId))));
  const other = (r: (typeof rows)[number]) => (r.userLow === userId ? r.userHigh : r.userLow);
  const ids = rows.map(other);
  const people = ids.length ? await db.select(personCols).from(profile).where(inArray(profile.userId, ids)) : [];
  const byId = new Map(people.map((p) => [p.userId, p]));
  const incoming: Person[] = [];
  const outgoing: Person[] = [];
  for (const r of rows) {
    const p = byId.get(other(r));
    if (!p) continue;
    (r.requestedBy === userId ? outgoing : incoming).push(p);
  }
  return { incoming, outgoing };
}

export async function findPersonByUsername(username: string): Promise<Person | null> {
  const [p] = await db.select(personCols).from(profile).where(eq(profile.username, normalizeUsername(username)));
  return p ?? null;
}

export async function updateUsername(userId: string, input: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const username = normalizeUsername(input);
  if (!isValidUsername(username)) return { ok: false, error: "Usernames are 3 to 20 letters, numbers or underscores." };
  const taken = await db.query.profile.findFirst({ where: and(eq(profile.username, username), sql`${profile.userId} <> ${userId}`) });
  if (taken) return { ok: false, error: "That username is taken." };
  await db.update(profile).set({ username }).where(eq(profile.userId, userId));
  return { ok: true };
}

/* ---------- Groups ---------- */

export const MAX_GROUPS = 20;
export const MAX_MEMBERS = 12;

export type GroupWithMembers = { id: string; name: string; ownerId: string; members: Person[] };

export async function isMember(userId: string, groupId: string): Promise<boolean> {
  const m = await db.query.groupMember.findFirst({ where: and(eq(groupMember.groupId, groupId), eq(groupMember.userId, userId)) });
  return Boolean(m);
}

async function membersOf(groupIds: string[]): Promise<Map<string, Person[]>> {
  if (!groupIds.length) return new Map();
  const rows = await db
    .select({ groupId: groupMember.groupId, joinedAt: groupMember.joinedAt, ...personCols })
    .from(groupMember)
    .innerJoin(profile, eq(groupMember.userId, profile.userId))
    .where(inArray(groupMember.groupId, groupIds))
    .orderBy(asc(groupMember.joinedAt));
  const map = new Map<string, Person[]>();
  for (const r of rows) {
    const list = map.get(r.groupId) ?? [];
    list.push({ userId: r.userId, username: r.username, displayName: r.displayName, avatarTone: r.avatarTone });
    map.set(r.groupId, list);
  }
  return map;
}

export async function listGroups(userId: string): Promise<GroupWithMembers[]> {
  const groups = await db
    .select({ id: friendGroup.id, name: friendGroup.name, ownerId: friendGroup.ownerId, createdAt: friendGroup.createdAt })
    .from(groupMember)
    .innerJoin(friendGroup, eq(groupMember.groupId, friendGroup.id))
    .where(eq(groupMember.userId, userId))
    .orderBy(asc(friendGroup.createdAt));
  const members = await membersOf(groups.map((g) => g.id));
  return groups.map((g) => ({ id: g.id, name: g.name, ownerId: g.ownerId, members: members.get(g.id) ?? [] }));
}

export async function getGroup(userId: string, groupId: string): Promise<GroupWithMembers | null> {
  if (!(await isMember(userId, groupId))) return null;
  const [g] = await db.select().from(friendGroup).where(eq(friendGroup.id, groupId));
  if (!g) return null;
  const members = await membersOf([groupId]);
  return { id: g.id, name: g.name, ownerId: g.ownerId, members: members.get(groupId) ?? [] };
}

const cleanName = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, 40);

export async function createGroup(userId: string, name: string, memberIds: string[]): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const n = cleanName(name);
  if (!n) return { ok: false, error: "Give the group a name." };
  const mine = await db.select({ id: groupMember.groupId }).from(groupMember).where(eq(groupMember.userId, userId));
  if (mine.length >= MAX_GROUPS) return { ok: false, error: "You are in as many groups as Cheese allows." };

  const wanted = [...new Set(memberIds)].filter((id) => id !== userId);
  if (wanted.length + 1 > MAX_MEMBERS) return { ok: false, error: `A group can have up to ${MAX_MEMBERS} people.` };
  const friends = new Set((await listFriends(userId)).map((f) => f.userId));
  if (wanted.some((id) => !friends.has(id))) return { ok: false, error: "You can only add your friends." };

  const id = await db.transaction(async (tx) => {
    const [g] = await tx.insert(friendGroup).values({ name: n, ownerId: userId }).returning();
    // Distinct join times keep "who has been here longest" well defined, owner first.
    const base = Date.now();
    await tx.insert(groupMember).values([userId, ...wanted].map((u, i) => ({ groupId: g.id, userId: u, joinedAt: new Date(base + i) })));
    return g.id;
  });
  return { ok: true, id };
}

export async function addGroupMember(userId: string, groupId: string, friendId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isMember(userId, groupId))) return { ok: false, error: "You are not in that group." };
  if (!(await areFriends(userId, friendId))) return { ok: false, error: "You can only add your friends." };
  if (await isMember(friendId, groupId)) return { ok: false, error: "They are already in the group." };
  const count = await db.select({ n: sql<number>`count(*)::int` }).from(groupMember).where(eq(groupMember.groupId, groupId));
  if ((count[0]?.n ?? 0) >= MAX_MEMBERS) return { ok: false, error: `A group can have up to ${MAX_MEMBERS} people.` };
  await db.insert(groupMember).values({ groupId, userId: friendId });
  return { ok: true };
}

export async function renameGroup(userId: string, groupId: string, name: string): Promise<boolean> {
  const n = cleanName(name);
  if (!n) return false;
  const res = await db.update(friendGroup).set({ name: n }).where(and(eq(friendGroup.id, groupId), eq(friendGroup.ownerId, userId))).returning({ id: friendGroup.id });
  return res.length > 0;
}

/** Leaves a group. The oldest remaining member takes over as owner, and an empty group is deleted. */
export async function leaveGroup(userId: string, groupId: string): Promise<boolean> {
  if (!(await isMember(userId, groupId))) return false;
  await db.transaction(async (tx) => {
    await tx.delete(groupMember).where(and(eq(groupMember.groupId, groupId), eq(groupMember.userId, userId)));
    const rest = await tx.select().from(groupMember).where(eq(groupMember.groupId, groupId)).orderBy(asc(groupMember.joinedAt));
    if (!rest.length) {
      await tx.delete(friendGroup).where(eq(friendGroup.id, groupId));
      return;
    }
    const [g] = await tx.select().from(friendGroup).where(eq(friendGroup.id, groupId));
    if (g?.ownerId === userId) await tx.update(friendGroup).set({ ownerId: rest[0].userId }).where(eq(friendGroup.id, groupId));
  });
  return true;
}

/** Only the owner can remove someone else. */
export async function removeGroupMember(ownerId: string, groupId: string, memberId: string): Promise<boolean> {
  if (ownerId === memberId) return false;
  const [g] = await db.select().from(friendGroup).where(and(eq(friendGroup.id, groupId), eq(friendGroup.ownerId, ownerId)));
  if (!g) return false;
  const res = await db.delete(groupMember).where(and(eq(groupMember.groupId, groupId), eq(groupMember.userId, memberId))).returning();
  return res.length > 0;
}

export async function deleteGroup(ownerId: string, groupId: string): Promise<boolean> {
  const res = await db.delete(friendGroup).where(and(eq(friendGroup.id, groupId), eq(friendGroup.ownerId, ownerId))).returning({ id: friendGroup.id });
  return res.length > 0;
}

/* ---------- What a friend can see ---------- */

/** A friend's list as you may see it: friends only, never the entries they hid. */
export async function friendLibrary(viewerId: string, friendId: string) {
  if (!(await areFriends(viewerId, friendId))) return null;
  const person = await personById(friendId);
  if (!person) return null;
  const rows = await db
    .select({ e: entry, i: item })
    .from(entry)
    .innerJoin(item, eq(entry.itemId, item.id))
    .where(and(eq(entry.userId, friendId), eq(entry.hidden, false)))
    .orderBy(sql`${entry.updatedAt} desc`);
  return { person, rows };
}

/** Names of friends who are open to doing this item together. Hidden entries never count. */
export async function friendsWanting(userId: string, itemId: string): Promise<string[]> {
  const friends = await listFriends(userId);
  if (!friends.length) return [];
  const rows = await db
    .select({ userId: entry.userId })
    .from(entry)
    .where(
      and(
        inArray(entry.userId, friends.map((f) => f.userId)),
        eq(entry.itemId, itemId),
        eq(entry.together, true),
        eq(entry.hidden, false),
        sql`(${entry.status} in ('want', 'in_progress', 'paused') or (${entry.status} = 'done' and ${entry.wouldRedo}))`,
      ),
    );
  const ids = new Set(rows.map((r) => r.userId));
  return friends.filter((f) => ids.has(f.userId)).map((f) => f.displayName);
}

/** "Sara wants this too", "Sara and Omar want this", "Sara, Omar and 2 more want this". */
export function wantingHint(names: string[]): string {
  if (names.length === 0) return "Open to doing this with friends";
  if (names.length === 1) return `${names[0]} wants this too`;
  if (names.length === 2) return `${names[0]} and ${names[1]} want this`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]} want this`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more want this`;
}
