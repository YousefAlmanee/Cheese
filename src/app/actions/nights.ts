"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { groupMember, item, night, RSVPS } from "@/db/schema";
import { parseLocal } from "@/lib/freetime";
import { cancelNight, createNight, joinAsGuest, lockIn, markNightDone, nightByToken, reopenVoting, setRsvp, toggleVote } from "@/lib/nights";
import { notify, notifyMany } from "@/lib/notifications";
import { currentUser, requireUser } from "@/lib/session";

type Form = { error?: string };
const uuid = z.uuid();

const baseSchema = z.object({
  groupId: z.uuid(),
  itemId: z.uuid(),
  durationMin: z.coerce.number().int(),
  units: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().min(1).max(1000).optional()),
  note: z.string().trim().max(500).optional(),
});

export async function proposeNight(_prev: Form | undefined, formData: FormData): Promise<Form> {
  const { user, profile } = await requireUser();
  const parsed = baseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the length and try again." };

  const options: { startsAt: Date; durationMin: number }[] = [];
  for (let i = 1; i <= 6; i++) {
    const day = String(formData.get(`day${i}`) ?? "");
    const start = String(formData.get(`start${i}`) ?? "");
    if (!day && !start) continue;
    const at = parseLocal(profile.timezone, day, start);
    if (!at) return { error: `Check the day and time for option ${i}.` };
    options.push({ startsAt: at, durationMin: parsed.data.durationMin });
  }
  const res = await createNight(user.id, { groupId: parsed.data.groupId, itemId: parsed.data.itemId, options, units: parsed.data.units ?? null, note: parsed.data.note });
  if (!res.ok) return { error: res.error };

  // Let everyone else in the group know a night was proposed, so they can vote.
  const [it] = await db.select({ title: item.title }).from(item).where(eq(item.id, parsed.data.itemId));
  const members = await db.select({ userId: groupMember.userId }).from(groupMember).where(eq(groupMember.groupId, parsed.data.groupId));
  const others = members.map((m) => m.userId).filter((uid) => uid !== user.id);
  await notifyMany(others, { type: "night_invite", title: `${profile.displayName} suggested a movie night`, body: it?.title ?? null, url: `/night/${res.id}` });

  revalidatePath("/friends");
  redirect(`/night/${res.id}`);
}

function refresh(nightId: string) {
  revalidatePath(`/night/${nightId}`);
  revalidatePath("/friends");
  revalidatePath("/plan");
  revalidatePath("/");
}

export async function vote(nightId: string, optionId: string) {
  const { user, profile } = await requireUser();
  if (uuid.safeParse(nightId).success && uuid.safeParse(optionId).success) {
    const res = await toggleVote({ nightId, userId: user.id }, optionId);
    // Tell the host when a new vote lands (not when a vote is removed, and not for the host's own vote).
    if (res.ok && res.voted) {
      const [n] = await db.select({ hostId: night.hostId, itemId: night.itemId }).from(night).where(eq(night.id, nightId));
      if (n && n.hostId !== user.id) {
        const [it] = await db.select({ title: item.title }).from(item).where(eq(item.id, n.itemId));
        await notify({ userId: n.hostId, type: "night_vote", title: `${profile.displayName} voted on your night`, body: it?.title ?? null, url: `/night/${nightId}` });
      }
    }
  }
  refresh(nightId);
}

export async function pickTime(nightId: string, optionId: string) {
  const { user } = await requireUser();
  if (uuid.safeParse(nightId).success && uuid.safeParse(optionId).success) await lockIn(user.id, nightId, optionId);
  refresh(nightId);
}

export async function answerRsvp(nightId: string, formData: FormData) {
  const { user } = await requireUser();
  const status = z.enum(RSVPS).safeParse(formData.get("status"));
  if (uuid.safeParse(nightId).success && status.success) await setRsvp({ nightId, userId: user.id }, status.data);
  refresh(nightId);
}

export async function changeTime(nightId: string) {
  const { user } = await requireUser();
  if (uuid.safeParse(nightId).success) await reopenVoting(user.id, nightId);
  refresh(nightId);
}

export async function finishNight(nightId: string) {
  const { user } = await requireUser();
  if (uuid.safeParse(nightId).success) await markNightDone(user.id, nightId);
  refresh(nightId);
}

export async function dropNight(nightId: string) {
  const { user } = await requireUser();
  if (uuid.safeParse(nightId).success) await cancelNight(user.id, nightId);
  refresh(nightId);
  redirect("/friends");
}

/* ---------- The shared link: no account needed ---------- */

const guestCookie = (token: string) => `cheese-night-${token.slice(0, 16)}`;

function refreshPublic(token: string) {
  revalidatePath(`/n/${token}`);
}

export async function joinNight(token: string, _prev: Form | undefined, formData: FormData): Promise<Form> {
  const name = z.string().max(60).safeParse(formData.get("name"));
  if (!name.success) return { error: "Type your name." };
  const res = await joinAsGuest(token, name.data);
  if (!res.ok) return { error: res.error };
  (await cookies()).set(guestCookie(token), res.secret, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 60, path: "/" });
  refreshPublic(token);
  return {};
}

async function publicWho(token: string): Promise<({ nightId: string; viaToken: true; userId: string } | { nightId: string; guestSecret: string }) | null> {
  const view = await nightByToken(token);
  if (!view) return null;
  const me = await currentUser();
  if (me) return { nightId: view.night.id, viaToken: true, userId: me.user.id };
  const secret = (await cookies()).get(guestCookie(token))?.value;
  return secret ? { nightId: view.night.id, guestSecret: secret } : null;
}

export async function publicVote(token: string, optionId: string) {
  const who = await publicWho(token);
  if (who && uuid.safeParse(optionId).success) await toggleVote(who, optionId);
  refreshPublic(token);
}

export async function publicRsvp(token: string, formData: FormData) {
  const who = await publicWho(token);
  const status = z.enum(RSVPS).safeParse(formData.get("status"));
  if (who && status.success) {
    if ("guestSecret" in who) await setRsvp({ nightId: who.nightId, guestSecret: who.guestSecret }, status.data);
    else await setRsvp({ nightId: who.nightId, userId: who.userId }, status.data);
  }
  refreshPublic(token);
}
