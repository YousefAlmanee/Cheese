import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry } from "@/db/schema";
import { importOne, matchRows } from "@/lib/letterboxd-import";
import { resetProviderCache } from "@/lib/providers/http";
import { makeUser, resetDb } from "./helpers";

const row = (over = {}) => ({ name: "Dune", year: 2021, watched: "2021-02-03", ratingHalf: 9, watchlist: false, ...over });

function mockTmdb() {
  vi.stubEnv("TMDB_API_KEY", "abc123");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (u.includes("/search/movie")) {
        return json({
          results: u.includes("Nothing")
            ? []
            : [
                { id: 1, title: "Dune", release_date: "1984-12-14" },
                { id: 438631, title: "Dune", release_date: "2021-09-15" },
              ],
        });
      }
      if (u.includes("/movie/438631")) return json({ id: 438631, title: "Dune", release_date: "2021-09-15", runtime: 155, genres: [] });
      return new Response("nf", { status: 404 });
    }),
  );
}

beforeEach(async () => {
  await resetDb();
  mockTmdb();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetProviderCache();
});

describe("matchRows", () => {
  it("picks the release from the right year and reports misses", async () => {
    const [a, b] = await matchRows([row(), row({ name: "Nothing Here", year: 2000 })]);
    expect(a.ref).toBe("movie/438631");
    expect(b.ref).toBeNull();
  });
});

describe("importOne", () => {
  it("adds a watched film as finished with its date and rating", async () => {
    const me = await makeUser("Yousef");
    expect(await importOne(me.id, { row: row(), ref: "movie/438631" })).toBe("added");
    const [e] = await db.select().from(entry).where(eq(entry.userId, me.id));
    expect(e).toMatchObject({ status: "done", ratingHalf: 9, progress: 1 });
    expect(e.finishedAt?.toISOString().slice(0, 10)).toBe("2021-02-03");
  });

  it("adds a watchlist film as want", async () => {
    const me = await makeUser("Yousef");
    await importOne(me.id, { row: row({ watched: null, ratingHalf: null, watchlist: true }), ref: "movie/438631" });
    const [e] = await db.select().from(entry).where(eq(entry.userId, me.id));
    expect(e.status).toBe("want");
  });

  it("does not change a film already finished, but fills in a missing rating", async () => {
    const me = await makeUser("Yousef");
    await importOne(me.id, { row: row({ ratingHalf: null, watched: "2020-01-01" }), ref: "movie/438631" });
    expect(await importOne(me.id, { row: row({ watched: "2021-02-03" }), ref: "movie/438631" })).toBe("updated");
    const [e] = await db.select().from(entry).where(eq(entry.userId, me.id));
    expect(e.ratingHalf).toBe(9);
    expect(e.finishedAt?.toISOString().slice(0, 10)).toBe("2020-01-01");
    expect(await importOne(me.id, { row: row(), ref: "movie/438631" })).toBe("skipped");
  });

  it("does not downgrade a finished film from a watchlist row", async () => {
    const me = await makeUser("Yousef");
    await importOne(me.id, { row: row(), ref: "movie/438631" });
    expect(await importOne(me.id, { row: row({ watchlist: true, watched: null, ratingHalf: null }), ref: "movie/438631" })).toBe("skipped");
    const [e] = await db.select().from(entry).where(eq(entry.userId, me.id));
    expect(e.status).toBe("done");
  });

  it("reports a failure when the lookup fails", async () => {
    const me = await makeUser("Yousef");
    expect(await importOne(me.id, { row: row(), ref: "movie/999" })).toBe("failed");
  });
});
