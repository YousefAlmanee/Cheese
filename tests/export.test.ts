import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry, planSession, profile, progressLog } from "@/db/schema";
import { csvCell, exportAll, libraryCsv } from "@/lib/export";
import { addEntry, upsertItem } from "@/lib/library";
import { makeUser, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
});

async function add(userId: string, title: string, externalId = title) {
  const row = await upsertItem({
    category: "movie", source: "tmdb", externalId: `movie/${externalId}`, title, creator: "A, B", year: 2020, coverUrl: null, summary: null,
    unit: "watch", totalUnits: 1, unitSeconds: 7200, genres: [], platforms: [],
  });
  return (await addEntry(userId, row.id)).entry;
}

describe("exportAll", () => {
  it("holds the person's own list, including hidden items, ratings and time", async () => {
    const me = await makeUser("Yousef");
    const e = await add(me.id, "Dune");
    const secret = await add(me.id, "Secret", "secret");
    await db.update(entry).set({ ratingHalf: 9, review: "Great" }).where(eq(entry.id, e.id));
    await db.update(entry).set({ hidden: true }).where(eq(entry.id, secret.id));
    await db.insert(progressLog).values({ userId: me.id, entryId: e.id, deltaUnits: 1, minutes: 120 });
    await db.insert(planSession).values({ userId: me.id, title: "Dune", startsAt: new Date("2026-10-20T17:00:00Z"), durationMin: 120 });

    const data = (await exportAll(me.id))!;
    expect(data.library.map((l) => l.title).sort()).toEqual(["Dune", "Secret"]);
    expect(data.library.find((l) => l.title === "Dune")).toMatchObject({ rating: 4.5, review: "Great" });
    expect(data.library.find((l) => l.title === "Secret")?.hidden).toBe(true);
    expect(data.timeLog).toHaveLength(1);
    expect(data.plannedSessions).toHaveLength(1);
  });

  it("has nobody else's data and none of the private links", async () => {
    const me = await makeUser("Yousef");
    const other = await makeUser("Sara");
    await add(other.id, "Hers");
    await add(me.id, "Mine", "mine");
    const data = (await exportAll(me.id))!;
    expect(data.library.map((l) => l.title)).toEqual(["Mine"]);
    const [p] = await db.select().from(profile).where(eq(profile.userId, me.id));
    const json = JSON.stringify(data);
    expect(json).not.toContain(p.icsToken);
    expect(json).not.toContain(p.inviteCode);
    expect(json).not.toContain(me.email);
  });

  it("is null for someone with no profile", async () => {
    expect(await exportAll("nobody")).toBeNull();
  });
});

describe("csv", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("A, B")).toBe('"A, B"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("one\ntwo")).toBe('"one\ntwo"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(4.5)).toBe("4.5");
  });

  it("stops a title from running as a spreadsheet formula", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("-1+1")).toBe("'-1+1");
    expect(csvCell(-3)).toBe("-3"); // a real number stays a number
  });

  it("writes a header and one row per entry", async () => {
    const me = await makeUser("Yousef");
    await add(me.id, "Dune");
    const lines = libraryCsv((await exportAll(me.id))!).trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("title,category,creator")).toBe(true);
    expect(lines[1].startsWith('Dune,movie,"A, B",2020,want')).toBe(true);
  });
});
