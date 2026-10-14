import { expect, test, type Browser } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profile } from "@/db/schema";
import { respondToRequest, sendFriendRequest } from "@/lib/friends";
import { resetDb } from "../helpers";
import { seedDemo, userIdByName } from "../seed";
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

test("recommend a title to a friend, who adds it from the Friends screen", async ({ browser }) => {
  const a = await person(browser, "Yousef");
  const b = await person(browser, "Sara");
  const [pb] = await db.select().from(profile).where(eq(profile.userId, b.id));
  await sendFriendRequest(a.id, pb.username);
  await respondToRequest(b.id, a.id, true);
  const seeded = await seedDemo(a.id);

  await a.page.goto(`/item/${seeded["Interstellar"].id}`);
  await a.page.getByRole("link", { name: "Recommend to a friend" }).click();
  await a.page.getByLabel("Recommend to Sara").check();
  await a.page.getByLabel("Add a note (optional)").fill("Watch it on a big screen");
  await a.page.getByRole("button", { name: "Send" }).click();
  await expect(a.page.getByText("Sent to 1 friend.")).toBeVisible();

  await b.page.goto("/friends");
  await expect(b.page.getByText("Recommended to you")).toBeVisible();
  await expect(b.page.getByText("From Yousef")).toBeVisible();
  await expect(b.page.getByText("Watch it on a big screen")).toBeVisible();
  await b.page.getByRole("button", { name: "Add Interstellar to my list" }).click();
  await expect(b.page).toHaveURL(/\/item\//);
  await expect(b.page.getByRole("heading", { name: "Interstellar" })).toBeVisible();

  await b.page.goto("/friends");
  await expect(b.page.getByText("Recommended to you")).toHaveCount(0);
});

test("a hidden item cannot be recommended", async ({ page }) => {
  await signIn(page, "Yousef");
  const seeded = await seedDemo(await userIdByName("Yousef"));
  const { db: d } = await import("@/db");
  const { entry } = await import("@/db/schema");
  await d.update(entry).set({ hidden: true }).where(eq(entry.id, seeded["Interstellar"].id));
  await page.goto(`/item/${seeded["Interstellar"].id}`);
  await expect(page.getByRole("link", { name: "Recommend to a friend" })).toHaveCount(0);
  await page.goto(`/item/${seeded["Interstellar"].id}/recommend`);
  await expect(page.getByText("This is hidden from friends")).toBeVisible();
});
