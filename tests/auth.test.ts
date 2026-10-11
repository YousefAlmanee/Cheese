import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { profile } from "@/db/schema";
import { ensureProfile } from "@/lib/profile";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

describe("sign up", () => {
  it("creates a profile with a username, invite code and calendar token", async () => {
    const res = await auth.api.signUpEmail({ body: { name: "Sara Khan", email: "sara@example.com", password: "1234" } });
    const p = await db.query.profile.findFirst({ where: eq(profile.userId, res.user.id) });
    expect(p?.username).toBe("sara_khan");
    expect(p?.displayName).toBe("Sara Khan");
    expect(p?.inviteCode.length).toBeGreaterThanOrEqual(6);
    expect(p?.icsToken.length).toBeGreaterThanOrEqual(20);
  });

  it("gives the second Sara a different username", async () => {
    await auth.api.signUpEmail({ body: { name: "Sara Khan", email: "a@example.com", password: "1234" } });
    const b = await auth.api.signUpEmail({ body: { name: "Sara Khan", email: "b@example.com", password: "1234" } });
    const p = await db.query.profile.findFirst({ where: eq(profile.userId, b.user.id) });
    expect(p?.username).toMatch(/^sara_khan\d{3,5}$/);
  });
});

describe("ensureProfile", () => {
  it("is idempotent", async () => {
    const u = await makeUser("Omar");
    const again = await ensureProfile({ id: u.id, name: u.name, email: u.email });
    expect(again.username).toBe(u.profile.username);
    expect(await db.select().from(profile)).toHaveLength(1);
  });
});
