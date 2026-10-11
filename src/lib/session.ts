import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { ensureProfile } from "./profile";

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/** The signed-in user and their profile, looked up once per request (layouts and pages both ask), or null. */
const loadUser = cache(async () => {
  const session = await getSession();
  if (!session) return null;
  const profile = await ensureProfile(session.user);
  return { user: session.user, profile };
});

/** Returns the signed-in user and profile, or sends the visitor to /login. Call this in every page and action. */
export async function requireUser() {
  const current = await loadUser();
  if (!current) redirect("/login");
  return current;
}

/** Same as requireUser but returns null instead of redirecting. For route handlers and public pages. */
export async function currentUser() {
  return loadUser();
}
