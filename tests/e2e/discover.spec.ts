import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry, item, profile } from "@/db/schema";
import { respondToRequest, sendFriendRequest } from "@/lib/friends";
import { addEntry, upsertItem } from "@/lib/library";
import type { ItemDraft } from "@/lib/providers/types";
import { resetDb } from "../helpers";
import { userIdByName } from "../seed";
import { signIn } from "./helpers";

test.beforeEach(async () => {
  await resetDb();
});

async function openDune(page: import("@playwright/test").Page) {
  await page.goto("/add");
  await page.getByRole("searchbox", { name: "Search everything" }).fill("dune");
  await page.getByRole("link", { name: "Details for Dune (Movie)" }).click();
  await expect(page).toHaveURL(/\/discover\?/);
}

test("a search result opens its details without adding it", async ({ page }) => {
  await signIn(page, "Yousef");
  await openDune(page);
  await expect(page.getByRole("heading", { name: "Dune" })).toBeVisible();
  await expect(page.getByText("None of your friends have this in their list yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to my list" })).toBeVisible();
  expect(await db.select().from(entry)).toHaveLength(0);
});

test("add it as already watched, straight from the details page", async ({ page }) => {
  await signIn(page, "Yousef");
  await openDune(page);
  await page.getByRole("button", { name: "Watched it" }).click();
  await page.waitForURL(/\/item\/.+rate=1/);
  const [e] = await db.select().from(entry);
  expect(e.status).toBe("done");
});

test("start it from the details page", async ({ page }) => {
  await signIn(page, "Yousef");
  await openDune(page);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/item\//);
  const [e] = await db.select().from(entry);
  expect(e.status).toBe("in_progress");
});

test("details show which friends have it, and a title already in your list opens the item page", async ({ browser, page }) => {
  await signIn(page, "Yousef");
  const ctx = await browser.newContext();
  await signIn(await ctx.newPage(), "Sara");
  const me = await userIdByName("Yousef");
  const sara = await userIdByName("Sara");
  const [ps] = await db.select().from(profile).where(eq(profile.userId, sara));
  await sendFriendRequest(me, ps.username);
  await respondToRequest(sara, me, true);

  const dune: ItemDraft = {
    category: "movie", source: "tmdb", externalId: "movie/438631", title: "Dune", creator: null, year: null, coverUrl: null,
    summary: null, unit: "watch", totalUnits: 1, unitSeconds: 155 * 60, genres: [], platforms: [],
  };
  const it = await upsertItem(dune);
  const { entry: e } = await addEntry(sara, it.id);
  await db.update(entry).set({ status: "done", ratingHalf: 9 }).where(eq(entry.id, e.id));

  await openDune(page);
  await expect(page.getByText("Sara", { exact: true })).toBeVisible();
  await expect(page.getByText("Rated 4.5 out of 5")).toBeVisible();

  // Once it is in my list the same link lands on the real item page.
  await page.getByRole("button", { name: "Add to my list" }).click();
  await page.waitForURL(/\/item\//);
  await page.goBack();
  await page.goto(`/discover?source=tmdb&id=${encodeURIComponent("movie/438631")}&c=movie`);
  await expect(page).toHaveURL(/\/item\//);
  expect(await db.select().from(item).where(eq(item.title, "Dune"))).toHaveLength(1);
  await ctx.close();
});

test("a bad link says so instead of crashing", async ({ page }) => {
  await signIn(page, "Yousef");
  await page.goto("/discover?source=nope&id=1&c=movie");
  await expect(page.getByText("That title could not be opened.")).toBeVisible();
});
