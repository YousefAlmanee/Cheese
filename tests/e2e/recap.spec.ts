import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profile, progressLog } from "@/db/schema";
import { resetDb } from "../helpers";
import { userIdByName } from "../seed";
import { signIn } from "./helpers";

test.beforeEach(async () => {
  await resetDb();
});

test("the recap page shows the week so far", async ({ page }) => {
  await signIn(page, "Yousef");
  await page.goto("/recap");
  await expect(page.getByRole("heading", { name: "Your week" })).toBeVisible();
  await expect(page.getByText("0m logged")).toBeVisible();
  await expect(page.getByText("Nothing finished yet this week.")).toBeVisible();

  const userId = await userIdByName("Yousef");
  await db.insert(progressLog).values({ userId, deltaUnits: 1, minutes: 75 });
  await page.reload();
  await expect(page.getByText("1h 15m logged")).toBeVisible();
});

test("the recap can be turned off in Settings", async ({ page }) => {
  await signIn(page, "Yousef");
  await page.goto("/settings");
  const group = page.getByRole("group", { name: "Sunday evening recap" });
  await expect(group.getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true");
  await group.getByRole("button", { name: "Off" }).click();
  await expect(group.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");

  const userId = await userIdByName("Yousef");
  await expect.poll(async () => (await db.select().from(profile).where(eq(profile.userId, userId)))[0].recapEnabled).toBe(false);
});
