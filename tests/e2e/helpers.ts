import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profile } from "@/db/schema";
import { user } from "@/db/auth-schema";

export const TEST_PIN = "1234";

/** Signs in through the real login form with a username and PIN, creating the account the first time. */
export async function signIn(page: Page, name: string) {
  await page.goto("/login");
  await fillAndSubmit(page, name);
}

/** Fills the username and PIN on the login page that is already open. Signs in, or creates the account if it does not exist yet. */
export async function fillAndSubmit(page: Page, name: string) {
  await page.fill("#username", name.toLowerCase());
  await page.fill("#pin", TEST_PIN);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const failed = page.getByText("Wrong username or PIN.");
  await Promise.race([page.waitForURL((u) => !u.pathname.startsWith("/login")), failed.waitFor()]).catch(() => {});
  if (await failed.isVisible()) {
    await page.getByRole("button", { name: "New here? Create an account" }).click();
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    // The form only asks for a username, so give the new account a proper display name the specs can look for.
    const [u] = await db.select().from(user).where(eq(user.username, name.toLowerCase()));
    if (u) await db.update(profile).set({ displayName: name }).where(eq(profile.userId, u.id));
  }
}
