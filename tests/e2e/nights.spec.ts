import { expect, test, type Browser, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { entry, night, nightParticipant, planSession, profile } from "@/db/schema";
import { createGroup, respondToRequest, sendFriendRequest } from "@/lib/friends";
import { addEntry, upsertItem } from "@/lib/library";
import { resetDb } from "../helpers";
import { userIdByName } from "../seed";
import { signIn } from "./helpers";

test.beforeEach(async () => {
  await resetDb();
});

const HOST_ZONE = "Asia/Riyadh";
const DAY1 = DateTime.now().setZone(HOST_ZONE).plus({ days: 4 }).toISODate() as string;
const DAY2 = DateTime.now().setZone(HOST_ZONE).plus({ days: 5 }).toISODate() as string;

async function person(browser: Browser, name: string, timezoneId = HOST_ZONE) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId, locale: "en-US" });
  const page = await ctx.newPage();
  await signIn(page, name);
  const id = await userIdByName(name);
  await expect.poll(async () => (await db.select().from(profile).where(eq(profile.userId, id)))[0].timezone).toBe(timezoneId);
  return { page, id, ctx };
}

async function club(browser: Browser) {
  const a = await person(browser, "Yousef");
  const b = await person(browser, "Sara");
  const c = await person(browser, "Omar");
  for (const x of [b, c]) {
    const [p] = await db.select().from(profile).where(eq(profile.userId, x.id));
    await sendFriendRequest(a.id, p.username);
    await respondToRequest(x.id, a.id, true);
  }
  const g = await createGroup(a.id, "Movie nights", [b.id, c.id]);
  if (!g.ok) throw new Error(g.error);
  const film = await upsertItem({ category: "movie", source: "tmdb", externalId: "movie/157336", title: "Interstellar", creator: "Christopher Nolan", year: 2014, coverUrl: null, summary: null, unit: "watch", totalUnits: 1, unitSeconds: 169 * 60, genres: [], platforms: [] });
  for (const u of [a, b, c]) {
    const { entry: e } = await addEntry(u.id, film.id);
    await db.update(entry).set({ together: true }).where(eq(entry.id, e.id));
  }
  return { a, b, c, groupId: g.id, film };
}

async function propose(page: Page, groupId: string, filmId: string) {
  await page.goto(`/friends/item/${filmId}?group=${groupId}`);
  await page.getByRole("link", { name: "Plan a night" }).click();
  await expect(page.getByRole("heading", { name: "Plan a night" })).toBeVisible();
  await page.fill("#day1", DAY1);
  await page.fill("#start1", "21:00");
  await page.fill("#day2", DAY2);
  await page.fill("#start2", "19:30");
  await page.fill("#day3", "");
  await page.fill("#start3", "");
  await page.fill("#day4", "");
  await page.fill("#start4", "");
  await page.getByRole("button", { name: "Send for voting" }).click();
  await expect(page).toHaveURL(/\/night\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop() as string;
}

test("propose a night: the form is filled in, the host's votes are in, and the share link is ready", async ({ browser }) => {
  const { a, groupId, film } = await club(browser);
  await a.page.goto(`/friends/item/${film.id}?group=${groupId}`);
  await a.page.getByRole("link", { name: "Plan a night" }).click();
  // Suggestions arrive pre-filled, and the length follows the movie.
  await expect(a.page.locator("#day1")).not.toHaveValue("");
  await expect(a.page.locator("#durationMin")).toHaveValue("170");

  const id = await propose(a.page, groupId, film.id);
  await expect(a.page.getByText("Pick a time that works")).toBeVisible();
  await expect(a.page.getByText(/Movie nights · proposed by you/)).toBeVisible();
  const options = a.page.locator(".ch-time");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText("9:00 pm");
  await expect(options.nth(0)).toContainText("2h 50m");
  await expect(options.nth(0)).toContainText("1 of 3");
  await expect(options.nth(1)).toContainText("7:30 pm");
  await expect(a.page.getByRole("link", { name: "Share to WhatsApp" })).toHaveAttribute("href", /wa\.me.*%2Fn%2F/);
  const [n] = await db.select().from(night).where(eq(night.id, id));
  await expect(a.page.getByLabel("Invite link")).toHaveValue(new RegExp(`/n/${n.publicToken}$`));
});

test("a member votes, the host picks, and the night lands on the right plans", async ({ browser }) => {
  const { a, b, c, groupId, film } = await club(browser);
  const id = await propose(a.page, groupId, film.id);

  await b.page.goto(`/night/${id}`);
  await expect(b.page.getByText("proposed by Yousef")).toBeVisible();
  const second = b.page.locator(".ch-time").nth(1);
  await second.getByRole("button", { name: "Vote" }).click();
  await expect(second.getByRole("button", { name: "Voted" })).toBeVisible();
  await expect(second).toContainText("2 of 3");
  await expect(second).toContainText("most votes");
  await b.page.getByRole("button", { name: "Voted" }).click();
  await expect(second.getByRole("button", { name: "Vote" })).toBeVisible(); // toggles off
  await second.getByRole("button", { name: "Vote" }).click();
  await expect(second.getByRole("button", { name: "Voted" })).toBeVisible();

  // Only the host sees "Pick this".
  await expect(b.page.getByRole("button", { name: "Pick this" })).toHaveCount(0);
  await a.page.goto(`/night/${id}`);
  await a.page.locator(".ch-time").nth(1).getByRole("button", { name: "Pick this" }).click();
  await expect(a.page.getByText("It is on", { exact: true })).toBeVisible();
  await expect(a.page.getByText("7:30 pm · 2h 50m")).toBeVisible();

  // Yousef and Sara have it on their plans; Omar, who did not vote, does not.
  const sessions = await db.select().from(planSession);
  expect(sessions.map((s) => s.userId).sort()).toEqual([a.id, b.id].sort());
  expect(sessions[0].startsAt.toISOString()).toBe(DateTime.fromISO(`${DAY2}T19:30`, { zone: HOST_ZONE }).toUTC().toISO());

  await b.page.goto(`/plan?day=${DAY2}`);
  await expect(b.page.getByText("Interstellar")).toBeVisible();
  await expect(b.page.getByText("with friends")).toBeVisible();
  await c.page.goto(`/plan?day=${DAY2}`);
  await expect(c.page.getByText("with friends")).toHaveCount(0);

  // Omar says he is coming, and it appears; then he cannot make it, and it goes.
  await c.page.goto(`/night/${id}`);
  await c.page.getByRole("button", { name: "Going" }).click();
  await expect(c.page.getByRole("button", { name: "Going" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await db.select().from(planSession).where(eq(planSession.userId, c.id))).length).toBe(1);
  await c.page.getByRole("button", { name: "Can't" }).click();
  await expect.poll(async () => (await db.select().from(planSession).where(eq(planSession.userId, c.id))).length).toBe(0);

  // Everyone can see who answered what.
  await a.page.reload();
  await expect(a.page.locator(".ch-lrow", { hasText: "Sara" })).toContainText("Going");
  await expect(a.page.locator(".ch-lrow", { hasText: "Omar" })).toContainText("Can't");
  // Voting is closed now.
  await expect(a.page.getByText("Pick a time that works")).toHaveCount(0);
});

test("a guest votes from the shared link, in their own timezone, with just a name", async ({ browser }) => {
  const { a, groupId, film } = await club(browser);
  const id = await propose(a.page, groupId, film.id);
  const [n] = await db.select().from(night).where(eq(night.id, id));

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "America/New_York", locale: "en-US" });
  const guest = await ctx.newPage();
  await guest.goto(`/n/${n.publicToken}`);
  await expect(guest.getByRole("heading", { name: "Yousef is planning a night" })).toBeVisible();
  // What WhatsApp and similar apps read when the link is pasted.
  await expect(guest.locator('meta[property="og:title"]')).toHaveAttribute("content", "Yousef is planning a night: Interstellar");
  await expect(guest.getByText("Add your name to vote on a time.")).toBeVisible();
  // 21:00 in Riyadh (UTC+3) is 14:00 in New York (UTC-4 in October).
  await expect(guest.locator(".ch-time").first()).toContainText("2:00 pm");
  await expect(guest.locator(".ch-vote")).toHaveCount(0); // no vote buttons until they add a name

  await guest.getByRole("button", { name: "Continue" }).click(); // empty name: the browser asks for it
  expect(await guest.locator("#name").evaluate((el) => (el as HTMLInputElement).validationMessage)).not.toBe("");
  await guest.fill("#name", "Dana");
  await guest.getByRole("button", { name: "Continue" }).click();
  await expect(guest.getByRole("button", { name: "Vote" }).first()).toBeVisible();

  await guest.getByRole("button", { name: "Vote" }).first().click();
  await expect(guest.getByRole("button", { name: "Voted" })).toHaveCount(1);
  await expect(guest.locator(".ch-time").first()).toContainText("2 of 4"); // three members plus Dana

  // The host sees Dana's vote.
  await a.page.goto(`/night/${id}`);
  await expect(a.page.locator(".ch-time").first()).toContainText("2 of 4");

  // Reloading keeps the guest recognised.
  await guest.reload();
  await expect(guest.getByRole("button", { name: "Voted" })).toHaveCount(1);
  await expect(guest.getByText("Add your name to vote on a time.")).toHaveCount(0);

  // After the host picks that time, the guest can answer too.
  await a.page.locator(".ch-time").first().getByRole("button", { name: "Pick this" }).click();
  await expect.poll(async () => (await db.select().from(night).where(eq(night.id, id)))[0].status).toBe("set");
  await guest.reload();
  await expect(guest.getByText("It is on", { exact: true })).toBeVisible();
  await guest.getByRole("button", { name: "Going" }).click();
  await expect(guest.getByRole("button", { name: "Going" })).toHaveAttribute("aria-pressed", "true");
  await expect(guest.locator(".ch-lrow", { hasText: "Dana" })).toContainText("Going");
  const guests = await db.select().from(nightParticipant).where(eq(nightParticipant.nightId, id));
  expect(guests.find((g) => g.guestName === "Dana")?.rsvp).toBe("going");
  await ctx.close();
});

test("a wrong or made-up link shows nothing", async ({ browser }) => {
  const a = await person(browser, "Yousef");
  expect((await a.page.goto("/n/not-a-real-token"))?.status()).toBe(404);
});

test("someone signed in but outside the group can vote as themselves through the link", async ({ browser }) => {
  const { a, groupId, film } = await club(browser);
  const id = await propose(a.page, groupId, film.id);
  const [n] = await db.select().from(night).where(eq(night.id, id));
  const outsider = await person(browser, "Outsider");

  expect((await outsider.page.goto(`/night/${id}`))?.status()).toBe(404); // not in the group
  await outsider.page.goto(`/n/${n.publicToken}`);
  await expect(outsider.page.getByText("Add your name to vote")).toHaveCount(0);
  await outsider.page.getByRole("button", { name: "Vote" }).first().click();
  await expect(outsider.page.getByRole("button", { name: "Voted" })).toHaveCount(1);
  await expect(outsider.page.locator(".ch-time").first()).toContainText("2 of 4");
});

test("changing the time and cancelling take the night off everyone's plan", async ({ browser }) => {
  const { a, b, groupId, film } = await club(browser);
  const id = await propose(a.page, groupId, film.id);
  await b.page.goto(`/night/${id}`);
  await b.page.locator(".ch-time").first().getByRole("button", { name: "Vote" }).click();
  await a.page.goto(`/night/${id}`);
  await a.page.locator(".ch-time").first().getByRole("button", { name: "Pick this" }).click();
  await expect.poll(async () => (await db.select().from(planSession)).length).toBe(2);

  await a.page.getByRole("button", { name: "Change the time" }).click();
  await expect(a.page.getByText("Pick a time that works")).toBeVisible();
  await expect.poll(async () => (await db.select().from(planSession)).length).toBe(0);
  await expect(a.page.locator(".ch-time").first()).toContainText("2 of 3"); // votes are kept

  await a.page.locator(".ch-time").first().getByRole("button", { name: "Pick this" }).click();
  await expect.poll(async () => (await db.select().from(planSession)).length).toBe(2);
  await a.page.getByRole("button", { name: "Cancel this night" }).click();
  await expect(a.page).toHaveURL(/\/friends$/);
  expect(await db.select().from(planSession)).toHaveLength(0);
  await b.page.goto(`/night/${id}`);
  await expect(b.page.getByText("This night was cancelled.")).toBeVisible();
});

test("the Friends tab lists nights coming up", async ({ browser }) => {
  const { a, b, groupId, film } = await club(browser);
  const id = await propose(a.page, groupId, film.id);
  await b.page.goto(`/friends?group=${groupId}`);
  await expect(b.page.getByText("Coming up")).toBeVisible();
  await expect(b.page.locator(`a[href="/night/${id}"]`)).toContainText("Voting on a time");
  await a.page.goto(`/night/${id}`);
  await a.page.locator(".ch-time").first().getByRole("button", { name: "Pick this" }).click();
  await expect.poll(async () => (await db.select().from(night).where(eq(night.id, id)))[0].status).toBe("set");
  await b.page.reload();
  await expect(b.page.locator(`a[href="/night/${id}"]`)).toContainText("9:00 pm");
});

test("after the night, marking your part done finishes the movie and asks for a rating", async ({ browser }) => {
  const { a, b, groupId, film } = await club(browser);
  const id = await propose(a.page, groupId, film.id);
  await b.page.goto(`/night/${id}`);
  await b.page.locator(".ch-time").first().getByRole("button", { name: "Vote" }).click();
  await a.page.goto(`/night/${id}`);
  await a.page.locator(".ch-time").first().getByRole("button", { name: "Pick this" }).click();
  await a.page.getByRole("button", { name: "We did it" }).click();
  await expect(a.page.getByText("It happened")).toBeVisible();

  await b.page.goto(`/plan?day=${DAY1}`);
  await b.page.getByRole("link", { name: /Interstellar/ }).click();
  await expect(b.page.getByRole("link", { name: "Open the night with friends" })).toBeVisible();
  await b.page.getByRole("button", { name: "Mark done" }).click();
  await expect(b.page).toHaveURL(/\/item\/.*\?rate=1/);
  await expect(b.page.getByText("Finished. How was it?")).toBeVisible();
  const [e] = await db.select().from(entry).where(eq(entry.userId, b.id));
  expect(e).toMatchObject({ status: "done", progress: 1 });
});

test("only group members can reach the proposal form", async ({ browser }) => {
  const { groupId, film } = await club(browser);
  const outsider = await person(browser, "Outsider");
  expect((await outsider.page.goto(`/night/new?group=${groupId}&item=${film.id}`))?.status()).toBe(404);
});

test("the calendar feed includes a picked night", async ({ browser }) => {
  const { a, groupId, film } = await club(browser);
  const id = await propose(a.page, groupId, film.id);
  await a.page.goto(`/night/${id}`);
  await a.page.locator(".ch-time").first().getByRole("button", { name: "Pick this" }).click();
  await expect.poll(async () => (await db.select().from(planSession)).length).toBe(1);
  const [p] = await db.select().from(profile).where(eq(profile.userId, a.id));
  const feed = await (await a.page.request.get(`/api/calendar/${p.icsToken}.ics`)).text();
  expect(feed).toContain("SUMMARY:Interstellar");
  expect(feed).toContain(`DTSTART:${DAY1.replaceAll("-", "")}T180000Z`); // 21:00 in Riyadh
});
