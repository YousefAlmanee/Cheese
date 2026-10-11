import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profile } from "@/db/schema";
import { inviteCode, randomToken } from "./tokens";
import { isValidUsername, usernameBase, usernameCandidates } from "./username";

/** Creates the profile row for a user if it does not exist yet. Safe to call repeatedly. */
export async function ensureProfile(user: { id: string; name: string; email: string; username?: string | null }) {
  const existing = await db.query.profile.findFirst({ where: eq(profile.userId, user.id) });
  if (existing) return existing;

  const displayName = user.name?.trim() || user.email.split("@")[0];
  const base = usernameBase(user.name?.trim() ? user.name : user.email);
  const tone = (Math.abs(hash(user.id)) % 4) + 1;

  // Prefer the handle the person chose at sign-up; fall back to generated candidates if it is somehow taken.
  const preferred = user.username && isValidUsername(user.username) ? [user.username] : [];
  for (const username of [...preferred, ...usernameCandidates(base)]) {
    const [created] = await db
      .insert(profile)
      .values({
        userId: user.id,
        username,
        displayName,
        avatarTone: tone,
        icsToken: randomToken(),
        inviteCode: inviteCode(),
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    // Another request may have created this user's profile while we looped.
    const again = await db.query.profile.findFirst({ where: eq(profile.userId, user.id) });
    if (again) return again;
  }
  throw new Error("Could not allocate a username");
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
