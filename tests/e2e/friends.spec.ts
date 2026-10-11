import { expect, test, type Browser, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry, friendship, groupMember, profile } from "@/db/schema";
import { createGroup, respondToRequest, sendFriendRequest } from "@/lib/friends";
import { addEntry, upsertItem } from "@/lib/library";
import type { ItemDraft } from "@/lib/providers/types";
import { resetDb } from "../helpers";
import { seedDemo, userIdByName } from "../seed";
import { signIn } from "./helpers";

test.beforeEach(async () => {
  await resetDb();
});

async function person(browser: Browser, name: string): Promise<{ page: Page; id: string }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await signIn(page, name);
  return { page, id: await userIdByName(name) };
}

async function befriend(aId: string, bId: string) {
  const [pb] = await db.select().from(profile).where(eq(profile.userId, bId));
  await sendFriendRequest(aId, pb.username);
  await respondToRequest(bId, aId, true);
}

const film = (title: string, ext: string, minutes = 120): ItemDraft => ({
  category: "movie", source: "tmdb", externalId: ext, title, creator: null, year: null, coverUrl: null, summary: null,
  unit: "watch", totalUnits: 1, unitSeconds: minutes * 60, genres: [], platforms: [],
});

async function wants(userId: string, draft: ItemDraft, patch: Partial<typeof entry.$inferInsert> = {}) {
  const it = await upsertItem(draft);
  const { entry: e } = await addEntry(userId, it.id);
  await db.update(entry).set({ together: true, ...patch }).where(eq(entry.id, e.id));
  return it;
}

test("a newcomer opens an invite link, signs in, and becomes friends with a button press", async ({ browser, page }) => {
  await signIn(page, "Yousef");
  const me = await userIdByName("Yousef");
  const [p] = await db.select().from(profile).where(eq(profile.userId, me));

  await page.goto("/friends/add");
  await expect(page.getByLabel("Invite link")).toHaveValue(new RegExp(`/i/${p.inviteCode}$`));
  await expect(page.getByRole("link", { name: "Share to WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=.*%2Fi%2F/);

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const sara = await ctx.newPage();
  await sara.goto(`/i/${p.inviteCode}`);
  await expect(sara).toHaveURL(/\/login\?next=%2Fi%2F/);
  await sara.fill("#name", "Sara");
  await sara.fill("#email", "sara@example.com");
  await sara.fill("#password", "correct horse battery");
  await sara.getByRole("button", { name: "Sign in or create account" }).click();
  await sara.waitForURL(new RegExp(`/i/${p.inviteCode}$`));
  await expect(sara.getByText("Yousef invited you to Cheese.")).toBeVisible();

  // Opening the link did not make them friends. The button does.
  expect(await db.select().from(friendship)).toHaveLength(0);
  await sara.getByRole("button", { name: "Add Yousef" }).click();
  await expect(sara).toHaveURL(/\/friends\/people\?added=yousef/);
  await expect(sara.getByText("You and Yousef are now friends.")).toBeVisible();
  await expect(sara.getByRole("link", { name: /Yousef/ })).toBeVisible();
  expect((await db.select().from(friendship))[0].status).toBe("accepted");
  await ctx.close();
});

test("an invalid invite link says so", async ({ page }) => {
  await signIn(page, "Yousef");
  await page.goto("/i/notarealcode");
  await expect(page.getByText("That invite link is not valid any more.")).toBeVisible();
});

test("ask by username, the other person accepts from their Friends tab", async ({ browser }) => {
  const a = await person(browser, "Yousef");
  const b = await person(browser, "Sara");
  const [pb] = await db.select().from(profile).where(eq(profile.userId, b.id));

  await a.page.goto("/friends/add");
  await a.page.fill("#username", `@${pb.username}`);
  await a.page.getByRole("button", { name: "Send request" }).click();
  await expect(a.page.getByText("Asked Sara.")).toBeVisible();
  await a.page.fill("#username", pb.username);
  await a.page.getByRole("button", { name: "Send request" }).click();
  await expect(a.page.getByText("You already asked Sara. They need to accept.")).toBeVisible();
  await a.page.fill("#username", "nobody_here");
  await a.page.getByRole("button", { name: "Send request" }).click();
  await expect(a.page.getByText("No one has that username.")).toBeVisible();

  await b.page.goto("/friends");
  await expect(b.page.getByText("wants to be friends")).toBeVisible();
  await b.page.getByRole("button", { name: "Accept" }).click();
  await expect(b.page.getByText("wants to be friends")).toHaveCount(0);
  await b.page.goto("/friends/people");
  await expect(b.page.getByRole("link", { name: /Yousef/ })).toBeVisible();
  expect((await db.select().from(friendship))[0].status).toBe("accepted");
});

test("make a group from friends, and see it as a chip", async ({ browser }) => {
  const a = await person(browser, "Yousef");
  const b = await person(browser, "Sara");
  const c = await person(browser, "Omar");
  await befriend(a.id, b.id);
  await befriend(a.id, c.id);

  await a.page.goto("/friends");
  await a.page.getByRole("link", { name: "Make a group" }).click();
  await a.page.fill("#name", "Movie nights");
  await a.page.getByLabel("Add Sara").check();
  await a.page.getByLabel("Add Omar").check();
  await a.page.getByRole("button", { name: "Make group" }).click();
  await expect(a.page).toHaveURL(/\/friends\?group=/);
  await expect(a.page.getByRole("link", { name: "Movie nights", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(a.page.getByText("Nothing you all want yet")).toBeVisible();

  // Sara sees the same group.
  await b.page.goto("/friends");
  await expect(b.page.getByRole("link", { name: "Movie nights", exact: true })).toBeVisible();
  expect(await db.select().from(groupMember)).toHaveLength(3);
});

test.describe("the common list", () => {
  async function club(browser: Browser) {
    const a = await person(browser, "Yousef");
    const b = await person(browser, "Sara");
    const c = await person(browser, "Omar");
    await befriend(a.id, b.id);
    await befriend(a.id, c.id);
    const g = await createGroup(a.id, "Movie nights", [b.id, c.id]);
    if (!g.ok) throw new Error(g.error);
    const inter = film("Interstellar", "m/1", 169);
    const days = film("Perfect Days", "m/2", 124);
    const short = film("Short film", "m/3", 80);
    for (const u of [a, b, c]) await wants(u.id, inter);
    for (const u of [a, b]) await wants(u.id, days);
    for (const u of [b, c]) await wants(u.id, short);
    await wants(a.id, film("Only Yousef", "m/4"));
    await wants(c.id, film("Hidden by Omar", "m/5"));
    await wants(b.id, film("Hidden by Omar", "m/5"), { hidden: true });
    await wants(a.id, film("Private plans", "m/6"), { together: false });
    await wants(b.id, film("Private plans", "m/6"), { together: false });
    return { a, b, c, groupId: g.id };
  }

  test("ranks by how many want it, and shows the taste match", async ({ browser }) => {
    const { a } = await club(browser);
    await a.page.goto("/friends");
    await expect(a.page.getByText("3 things you all want")).toBeVisible();
    await expect(a.page.getByText("taste match")).toBeVisible();
    const titles = await a.page.locator(".ch-lrow .ch-row-title").allTextContents();
    expect(titles).toEqual(["Interstellar", "Perfect Days", "Short film"]);
    await expect(a.page.getByLabel("3 of 3 want this")).toHaveText("3/3");
    await expect(a.page.getByLabel("2 of 3 want this").first()).toHaveText("2/3");
    // Things hidden or not open to doing together are not shown to the group.
    await expect(a.page.getByText("Hidden by Omar")).toHaveCount(0);
    await expect(a.page.getByText("Private plans")).toHaveCount(0);
    await expect(a.page.getByText("Only Yousef")).toHaveCount(0);
  });

  test("filters by length", async ({ browser }) => {
    const { a } = await club(browser);
    await a.page.goto("/friends");
    await a.page.getByRole("link", { name: "Under 2h" }).click();
    await expect(a.page.locator(".ch-lrow .ch-row-title")).toHaveText(["Short film"]);
    await a.page.getByRole("link", { name: "Under 2h" }).click(); // toggles off
    await expect(a.page.locator(".ch-lrow")).toHaveCount(3);
    await a.page.getByRole("link", { name: "Games" }).click();
    await expect(a.page.getByText("Nothing matches those filters.")).toBeVisible();
    await a.page.getByRole("link", { name: "Clear filters" }).click();
    await expect(a.page.locator(".ch-lrow")).toHaveCount(3);
  });

  test("an item shows who wants it, and offers 'I want this too' to someone who does not have it", async ({ browser }) => {
    const { a, c, groupId } = await club(browser);
    // Omar does not have Perfect Days.
    await c.page.goto(`/friends?group=${groupId}`);
    await expect(c.page.locator(".ch-lrow .ch-row-title")).toHaveText(["Interstellar", "Perfect Days", "Short film"]);
    await c.page.getByRole("link", { name: /Perfect Days/ }).click();
    await expect(c.page.getByText("2 of 3 want this")).toBeVisible();
    await expect(c.page.getByText("Yousef, Sara")).toBeVisible();
    await expect(c.page.getByRole("link", { name: "Plan a night" })).toHaveAttribute("href", new RegExp(`/night/new\\?group=${groupId}&item=`));
    await c.page.getByRole("button", { name: "I want this too" }).click();
    await expect(c.page.getByText("3 of 3 want this")).toBeVisible();
    const mine = await db.select().from(entry).where(eq(entry.userId, c.id));
    expect(mine.find((e) => e.together && e.status === "want")).toBeTruthy();
    expect(a.id).toBeTruthy();
  });

  test("outsiders cannot see the group's common list", async ({ browser }) => {
    const { groupId } = await club(browser);
    const outsider = await person(browser, "Outsider");
    expect((await outsider.page.goto(`/friends/group/${groupId}`))?.status()).toBe(404);
    const sp = await outsider.page.goto(`/friends/item/00000000-0000-4000-8000-000000000000?group=${groupId}`);
    expect(sp?.status()).toBe(404);
  });
});

test.describe("a friend's page", () => {
  test("shows what they want and finished with ratings, never what they hid, and offers Add", async ({ browser }) => {
    const a = await person(browser, "Yousef");
    const b = await person(browser, "Sara");
    await befriend(a.id, b.id);
    const seeded = await seedDemo(b.id);
    await db.update(entry).set({ hidden: true }).where(eq(entry.id, seeded["Interstellar"].id));
    const [pb] = await db.select().from(profile).where(eq(profile.userId, b.id));

    await a.page.goto(`/friends/u/${pb.username}`);
    await expect(a.page.getByRole("heading", { name: "Sara" })).toBeVisible();
    await expect(a.page.getByText("Wants to do ·")).toBeVisible();
    await expect(a.page.locator(".ch-row-title", { hasText: "Spirited Away" })).toBeVisible();
    await expect(a.page.getByRole("img", { name: "Sara rated Spirited Away" })).toBeVisible();
    await expect(a.page.locator(".ch-row-title", { hasText: "Interstellar" })).toHaveCount(0);

    await a.page.getByRole("button", { name: "Add Frieren to my list" }).click();
    await expect(a.page.getByRole("link", { name: "Open Frieren" })).toBeVisible();
    const mine = await db.select().from(entry).where(eq(entry.userId, a.id));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: "want", together: false });
  });

  test("a stranger gets a not found page, the same as for a person who does not exist", async ({ browser }) => {
    const a = await person(browser, "Yousef");
    const b = await person(browser, "Sara");
    const [pb] = await db.select().from(profile).where(eq(profile.userId, b.id));
    expect((await a.page.goto(`/friends/u/${pb.username}`))?.status()).toBe(404);
    expect((await a.page.goto(`/friends/u/no_such_person`))?.status()).toBe(404);
  });
});

test("unfriending removes the friendship and the list", async ({ browser }) => {
  const a = await person(browser, "Yousef");
  const b = await person(browser, "Sara");
  await befriend(a.id, b.id);
  const [pb] = await db.select().from(profile).where(eq(profile.userId, b.id));
  await a.page.goto(`/friends/u/${pb.username}`);
  await a.page.getByRole("button", { name: "Remove Sara as a friend" }).click();
  await a.page.getByRole("button", { name: "Yes, remove" }).click(); // the first tap only asks
  await expect(a.page).toHaveURL(/\/friends\/people$/);
  expect(await db.select().from(friendship)).toHaveLength(0);
  expect((await a.page.goto(`/friends/u/${pb.username}`))?.status()).toBe(404);
});

test("group details: add a friend, leave, and the group stays for the others", async ({ browser }) => {
  const a = await person(browser, "Yousef");
  const b = await person(browser, "Sara");
  const c = await person(browser, "Omar");
  await befriend(a.id, b.id);
  await befriend(a.id, c.id);
  const g = await createGroup(a.id, "Club", [b.id]);
  if (!g.ok) throw new Error();

  await a.page.goto(`/friends/group/${g.id}`);
  await expect(a.page.getByText("People · 2")).toBeVisible();
  await a.page.locator("#friend").selectOption({ label: "Omar (@omar)" });
  await a.page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(a.page.getByText("People · 3")).toBeVisible();

  await a.page.getByRole("button", { name: "Leave group" }).click();
  await a.page.getByRole("button", { name: "Yes, leave" }).click(); // the first tap only asks
  await expect(a.page).toHaveURL(/\/friends$/);
  await b.page.goto(`/friends/group/${g.id}`);
  await expect(b.page.getByText("People · 2")).toBeVisible();
  await expect(b.page.getByText("Made this group")).toBeVisible(); // Sara took over
});

test("changing your username, and a taken one is refused", async ({ browser }) => {
  const a = await person(browser, "Yousef");
  const b = await person(browser, "Sara");
  const [pb] = await db.select().from(profile).where(eq(profile.userId, b.id));
  await a.page.goto("/settings");
  await a.page.fill("#username", pb.username);
  await a.page.getByRole("button", { name: "Save" }).click();
  await expect(a.page.getByText("That username is taken.")).toBeVisible();
  await a.page.fill("#username", "yousef_new");
  await a.page.fill("#displayName", "Yousef A");
  await a.page.getByRole("button", { name: "Save" }).click();
  await expect(a.page.getByText("Saved.")).toBeVisible();
  const [pa] = await db.select().from(profile).where(eq(profile.userId, a.id));
  expect(pa).toMatchObject({ username: "yousef_new", displayName: "Yousef A" });
});

test("signing out", async ({ browser }) => {
  const a = await person(browser, "Yousef");
  await a.page.goto("/settings");
  await a.page.getByRole("button", { name: "Sign out" }).click();
  await expect(a.page).toHaveURL(/\/login$/);
  await a.page.goto("/library");
  await expect(a.page).toHaveURL(/\/login$/);
});

test("with no friends the tab invites you", async ({ browser }) => {
  const a = await person(browser, "Yousef");
  await a.page.goto("/friends");
  await expect(a.page.getByText("Invite a friend to see what you both want to do.")).toBeVisible();
  await a.page.getByRole("link", { name: "Invite a friend" }).click();
  await expect(a.page).toHaveURL(/\/friends\/add$/);
});
