import { expect, test, type Browser } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry, profile } from "@/db/schema";
import { createGroup, respondToRequest, sendFriendRequest } from "@/lib/friends";
import { addEntry, upsertItem } from "@/lib/library";
import { resetDb } from "../helpers";
import { userIdByName } from "../seed";
import { signIn } from "./helpers";

test.beforeEach(async () => {
  await resetDb();
});

async function person(browser: Browser, name: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await signIn(page, name);
  return { page, id: await userIdByName(name) };
}

async function wants(userId: string, title: string, ext: string) {
  const it = await upsertItem({ category: "movie", source: "tmdb", externalId: ext, title, creator: null, year: 2020, coverUrl: null, summary: null, unit: "watch", totalUnits: 1, unitSeconds: 7200, genres: [], platforms: [] });
  const { entry: e } = await addEntry(userId, it.id);
  await db.update(entry).set({ together: true }).where(eq(entry.id, e.id));
}

test("two friends swipe through the group's list and land on what both said yes to", async ({ browser }) => {
  const a = await person(browser, "Yousef");
  const b = await person(browser, "Sara");
  const [pb] = await db.select().from(profile).where(eq(profile.userId, b.id));
  await sendFriendRequest(a.id, pb.username);
  await respondToRequest(b.id, a.id, true);
  const g = await createGroup(a.id, "Movie nights", [b.id]);
  if (!g.ok) throw new Error(g.error);
  for (const [t, ext] of [["Alien", "movie/1"], ["Brazil", "movie/2"]] as const) {
    await wants(a.id, t, ext);
    await wants(b.id, t, ext);
  }

  // Yousef says yes to both, using a button for the first and the arrow key for the second.
  await a.page.goto("/friends");
  await a.page.getByRole("link", { name: "Swipe to pick together" }).click();
  await expect(a.page.getByRole("heading", { name: "Alien" })).toBeVisible();
  await a.page.getByRole("button", { name: "Yes" }).click();
  await expect(a.page.getByRole("heading", { name: "Brazil" })).toBeVisible();
  await a.page.getByRole("article").focus();
  await a.page.keyboard.press("ArrowRight");
  await expect(a.page.getByText("You have been through all 2.")).toBeVisible();
  await expect(a.page.getByText("1 of 2 said yes")).toHaveCount(2);

  // Sara drags the first card to the right and says no to the second.
  await b.page.goto(`/friends/group/${g.id}/swipe`);
  await expect(b.page.getByRole("heading", { name: "Alien" })).toBeVisible();
  const card = b.page.getByRole("article");
  const box = (await card.boundingBox())!;
  await b.page.mouse.move(box.x + box.width / 2, box.y + 60);
  await b.page.mouse.down();
  await b.page.mouse.move(box.x + box.width / 2 + 160, box.y + 60, { steps: 6 });
  await b.page.mouse.up();
  await expect(b.page.getByRole("heading", { name: "Brazil" })).toBeVisible();
  await b.page.getByRole("button", { name: "Not for me" }).click();
  await expect(b.page.getByText("You have been through all 2.")).toBeVisible();

  await expect(b.page.getByText("Everyone said yes")).toHaveCount(1);
  await expect(b.page.getByRole("link", { name: "Plan a night for Alien" })).toBeVisible();
  await expect(b.page.getByRole("link", { name: "Plan a night for Brazil" })).toBeVisible();

  // Yousef was told when Sara made Alien unanimous, and can start over on his own answers.
  await a.page.goto("/notifications");
  await expect(a.page.getByText("Movie nights: everyone wants Alien")).toBeVisible();
  await a.page.goto(`/friends/group/${g.id}/swipe`);
  await a.page.getByRole("button", { name: "Start over with my answers" }).click();
  await expect(a.page.getByRole("heading", { name: "Alien" })).toBeVisible();
});

test("someone outside the group gets a not-found page", async ({ browser }) => {
  const a = await person(browser, "Yousef");
  const outsider = await person(browser, "Layla");
  const g = await createGroup(a.id, "Movie nights", []);
  if (!g.ok) throw new Error(g.error);
  await outsider.page.goto(`/friends/group/${g.id}/swipe`);
  await expect(outsider.page.getByText("That page doesn't exist, or it isn't shared with you.")).toBeVisible();
  await expect(outsider.page.getByText("Movie nights")).toHaveCount(0);
});
