"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { entry, item, profile } from "@/db/schema";
import {
  acceptInvite, addGroupMember, createGroup, deleteGroup, leaveGroup, removeFriend, removeGroupMember, renameGroup,
  respondToRequest, sendFriendRequest, updateUsername,
} from "@/lib/friends";
import { addEntry } from "@/lib/library";
import { requireUser } from "@/lib/session";

type Form = { message?: string; error?: string };
const id = z.string().min(1).max(64); // user ids
const groupIdSchema = z.uuid(); // group ids are uuids; anything else would make Postgres throw

function refresh() {
  revalidatePath("/friends");
  revalidatePath("/friends/people");
}

export async function requestFriend(_prev: Form | undefined, formData: FormData): Promise<Form> {
  const { user } = await requireUser();
  const username = z.string().max(40).safeParse(formData.get("username"));
  if (!username.success) return { error: "Type a username." };
  const res = await sendFriendRequest(user.id, username.data);
  refresh();
  return res.ok ? { message: res.message } : { error: res.error };
}

export async function answerRequest(otherId: string, accept: boolean) {
  const { user } = await requireUser();
  if (id.safeParse(otherId).success) await respondToRequest(user.id, otherId, accept);
  refresh();
}

export async function unfriend(otherId: string) {
  const { user } = await requireUser();
  if (id.safeParse(otherId).success) await removeFriend(user.id, otherId);
  refresh();
  redirect("/friends/people");
}

export async function acceptInviteAction(code: string) {
  const { user } = await requireUser();
  const res = await acceptInvite(user.id, code);
  refresh();
  redirect(res.ok && res.person ? `/friends/people?added=${encodeURIComponent(res.person.username)}` : "/friends/people");
}

export async function makeGroup(_prev: Form | undefined, formData: FormData): Promise<Form> {
  const { user } = await requireUser();
  const name = z.string().max(80).safeParse(formData.get("name"));
  if (!name.success) return { error: "Give the group a name." };
  const members = formData.getAll("member").map(String).filter((m) => id.safeParse(m).success);
  const res = await createGroup(user.id, name.data, members);
  if (!res.ok) return { error: res.error };
  refresh();
  redirect(`/friends?group=${res.id}`);
}

export async function addMember(groupId: string, formData: FormData) {
  const { user } = await requireUser();
  const friend = z.string().max(64).safeParse(formData.get("friend"));
  if (friend.success && groupIdSchema.safeParse(groupId).success) await addGroupMember(user.id, groupId, friend.data);
  refresh();
  revalidatePath(`/friends/group/${groupId}`);
}

export async function kickMember(groupId: string, memberId: string) {
  const { user } = await requireUser();
  if (groupIdSchema.safeParse(groupId).success && id.safeParse(memberId).success) await removeGroupMember(user.id, groupId, memberId);
  refresh();
  revalidatePath(`/friends/group/${groupId}`);
}

export async function renameGroupAction(groupId: string, _prev: Form | undefined, formData: FormData): Promise<Form> {
  const { user } = await requireUser();
  const name = z.string().max(80).safeParse(formData.get("name"));
  if (!name.success || !groupIdSchema.safeParse(groupId).success || !(await renameGroup(user.id, groupId, name.data))) return { error: "Only the person who made the group can rename it." };
  refresh();
  revalidatePath(`/friends/group/${groupId}`);
  return { message: "Saved." };
}

export async function leaveGroupAction(groupId: string) {
  const { user } = await requireUser();
  if (groupIdSchema.safeParse(groupId).success) await leaveGroup(user.id, groupId);
  refresh();
  redirect("/friends");
}

export async function deleteGroupAction(groupId: string) {
  const { user } = await requireUser();
  if (groupIdSchema.safeParse(groupId).success) await deleteGroup(user.id, groupId);
  refresh();
  redirect("/friends");
}

/** Adds something a friend wants to my own list. `together` marks it as open to doing with friends. */
export async function wantToo(itemId: string, backTo: string, together: boolean) {
  const { user } = await requireUser();
  if (z.uuid().safeParse(itemId).success) {
    const [it] = await db.select({ id: item.id }).from(item).where(eq(item.id, itemId));
    if (it) {
      const { entry: e } = await addEntry(user.id, it.id);
      if (together === true) await db.update(entry).set({ together: true }).where(and(eq(entry.id, e.id), eq(entry.userId, user.id)));
    }
  }
  refresh();
  revalidatePath("/library");
  redirect(backTo.startsWith("/") && !backTo.startsWith("//") ? backTo : "/friends");
}

const profileSchema = z.object({ displayName: z.string().trim().min(1, "Type a name.").max(40), username: z.string().max(40) });

export async function saveProfile(_prev: Form | undefined, formData: FormData): Promise<Form> {
  const { user } = await requireUser();
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const u = await updateUsername(user.id, parsed.data.username);
  if (!u.ok) return { error: u.error };
  await db.update(profile).set({ displayName: parsed.data.displayName }).where(eq(profile.userId, user.id));
  revalidatePath("/", "layout");
  return { message: "Saved." };
}
