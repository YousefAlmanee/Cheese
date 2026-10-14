import { expect, test } from "@playwright/test";
import { resetDb } from "../helpers";
import { seedDemo, userIdByName } from "../seed";
import { signIn } from "./helpers";

test.beforeEach(async () => {
  await resetDb();
});

test("Settings offers the person's data as JSON and CSV downloads", async ({ page }) => {
  await signIn(page, "Yousef");
  await seedDemo(await userIdByName("Yousef"));
  await page.goto("/settings");
  await expect(page.getByText("Your data", { exact: true })).toBeVisible();

  const json = await page.request.get("/api/export");
  expect(json.status()).toBe(200);
  expect(json.headers()["content-disposition"]).toContain("attachment");
  expect(json.headers()["cache-control"]).toBe("no-store");
  const body = await json.json();
  expect(body.profile.username).toBe("yousef");
  expect(body.library.map((l: { title: string }) => l.title)).toContain("Frieren");

  const csv = await page.request.get("/api/export?format=csv");
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("Frieren");
});

test("the export is not available when signed out", async ({ request }) => {
  const res = await request.get("/api/export");
  expect(res.status()).toBe(401);
});
