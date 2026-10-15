import { expect, test } from "@playwright/test";
import { resetDb } from "../helpers";
import { signIn } from "./helpers";

test.beforeEach(async () => {
  await resetDb();
});

test("Popular on the Add screen includes a Games shelf", async ({ page }) => {
  await signIn(page, "Yousef");
  await page.goto("/add");
  await expect(page.getByText("Games", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Elden Ring (Game)" })).toBeVisible();
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the sidebar stays on screens opened from a tab", async ({ page }) => {
    await signIn(page, "Yousef");
    for (const path of ["/", "/add", "/settings"]) {
      await page.goto(path);
      const nav = page.getByRole("navigation", { name: "Main" });
      await expect(nav).toBeVisible();
      const box = await nav.boundingBox();
      expect(box!.width).toBeLessThan(300);
      expect(box!.height).toBeGreaterThan(600);
    }
    await expect(page.getByRole("link", { name: "Add" })).toContainText("Add");
  });
});

test("phones keep the bottom bar off screens opened from a tab", async ({ page }) => {
  await signIn(page, "Yousef");
  await page.goto("/add");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await page.goto("/library");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});
