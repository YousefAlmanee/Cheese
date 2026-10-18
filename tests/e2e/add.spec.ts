import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry, item } from "@/db/schema";
import { resetDb } from "../helpers";
import { signIn } from "./helpers";

test.beforeEach(async () => {
  await resetDb();
});

test("search across categories and add a movie", async ({ page }) => {
  await signIn(page, "Yousef");
  await page.goto("/add");
  await page.getByRole("searchbox", { name: "Search everything" }).fill("dune");

  // One search shows movies, series, books and games together.
  await expect(page.getByText("Everything matching")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Dune (Movie)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Dune: Prophecy (Series)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Dune (Book)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Dune: Spice Wars (Game)" })).toBeVisible();

  await page.getByRole("button", { name: "Add Dune (Movie)" }).click();
  await expect(page.getByRole("link", { name: "Open Dune" }).first()).toContainText("Want to");

  const rows = await db.select().from(item).where(eq(item.title, "Dune"));
  const movie = rows.find((r) => r.category === "movie")!;
  expect(movie).toMatchObject({ source: "tmdb", externalId: "movie/438631", unitSeconds: 155 * 60, creator: "Denis Villeneuve" });
  expect(await db.select().from(entry).where(eq(entry.itemId, movie.id))).toHaveLength(1);
});

test("the quick Watched and Played buttons add a title as finished", async ({ page }) => {
  await signIn(page, "Yousef");
  await page.goto("/add");
  await page.getByRole("searchbox", { name: "Search everything" }).fill("dune");

  await page.getByRole("button", { name: "Watched: Dune (Movie)" }).click();
  await expect(page.getByRole("link", { name: "Open Dune" }).first()).toContainText("Done");
  await page.getByRole("button", { name: "Played: Dune: Spice Wars (Game)" }).click();
  await expect(page.getByRole("link", { name: "Open Dune: Spice Wars" })).toContainText("Done");

  const rows = await db.select({ title: item.title, status: entry.status, finishedAt: entry.finishedAt }).from(entry).innerJoin(item, eq(entry.itemId, item.id));
  expect(rows.map((r) => r.title).sort()).toEqual(["Dune", "Dune: Spice Wars"]);
  expect(rows.every((r) => r.status === "done" && r.finishedAt !== null)).toBe(true);
});

test("category chips narrow the search", async ({ page }) => {
  await signIn(page, "Yousef");
  await page.goto("/add");
  await page.getByRole("button", { name: "Games" }).click();
  await page.getByRole("searchbox", { name: "Search everything" }).fill("dune");
  await expect(page.getByRole("button", { name: "Add Dune: Spice Wars (Game)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Dune (Movie)" })).toHaveCount(0);
});

test("shows a calm message when nothing matches", async ({ page }) => {
  await signIn(page, "Yousef");
  await page.goto("/add");
  await page.getByRole("searchbox", { name: "Search everything" }).fill("zzzzzz");
  await expect(page.getByText("Nothing found for “zzzzzz”.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add it yourself" })).toBeVisible();
});

test("add something by hand", async ({ page }) => {
  await signIn(page, "Yousef");
  await page.goto("/add/manual");
  await page.getByRole("radio", { name: "Book" }).click();
  await page.fill("#title", "Family recipe notebook");
  await page.fill("#count", "80");
  await page.getByRole("button", { name: "Add to my list" }).click();
  await expect.poll(async () => (await db.select().from(item)).length).toBe(1);
  const [row] = await db.select().from(item);
  expect(row).toMatchObject({ source: "manual", category: "book", totalUnits: 80, title: "Family recipe notebook" });
});

test("a signed-out visitor is sent to sign in", async ({ page }) => {
  await page.goto("/add");
  await expect(page).toHaveURL(/\/login$/);
  const res = await page.request.get("/api/search?q=dune");
  expect(res.status()).toBe(401);
});
