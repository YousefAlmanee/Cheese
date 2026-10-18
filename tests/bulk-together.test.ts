import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry } from "@/db/schema";
import { setTogetherMany } from "@/lib/entries";
import { addEntry, upsertItem } from "@/lib/library";
import { makeUser, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
});

async function add(userId: string, n: number) {
  const row = await upsertItem({
    category: "movie", source: "tmdb", externalId: `movie/${n}`, title: `Film ${n}`, creator: null, year: 2020, coverUrl: null, summary: null,
    unit: "watch", totalUnits: 1, unitSeconds: 7200, genres: [], platforms: [],
  });
  return (await addEntry(userId, row.id)).entry;
}

describe("setTogetherMany", () => {
  it("marks the chosen entries and leaves the others alone", async () => {
    const me = await makeUser("Yousef");
    const [a, b, c] = [await add(me.id, 1), await add(me.id, 2), await add(me.id, 3)];
    expect(await setTogetherMany(me.id, [a.id, b.id], true)).toBe(2);
    const rows = await db.select().from(entry).where(eq(entry.userId, me.id));
    expect(Object.fromEntries(rows.map((r) => [r.id, r.together]))).toEqual({ [a.id]: true, [b.id]: true, [c.id]: false });
    expect(await setTogetherMany(me.id, [a.id], false)).toBe(1);
  });

  it("never touches someone else's entries", async () => {
    const me = await makeUser("Yousef");
    const other = await makeUser("Sara");
    const theirs = await add(other.id, 1);
    expect(await setTogetherMany(me.id, [theirs.id], true)).toBe(0);
    const [row] = await db.select().from(entry).where(eq(entry.id, theirs.id));
    expect(row.together).toBe(false);
  });

  it("does nothing for an empty list", async () => {
    const me = await makeUser("Yousef");
    expect(await setTogetherMany(me.id, [], true)).toBe(0);
  });
});
