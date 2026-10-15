import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { entry, progressLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { addEntry, upsertItem } from "@/lib/library";
import { computeStreak, loadStreak, streakLine } from "@/lib/streak";
import { makeUser, resetDb } from "./helpers";

// Mondays: 2026-09-14, 09-21, 09-28, 10-05, 10-12 (this week), 10-19.
const W = ["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"];

describe("computeStreak", () => {
  it("is zero with no history", () => {
    expect(computeStreak([], "2026-10-12")).toMatchObject({ current: 0, longest: 0, freezes: 0, activeThisWeek: false });
  });

  it("counts weeks in a row, and this week adds one once it has activity", () => {
    expect(computeStreak(["2026-09-28", "2026-10-05"], "2026-10-12")).toMatchObject({ current: 2, activeThisWeek: false });
    expect(computeStreak(["2026-09-28", "2026-10-05", "2026-10-12"], "2026-10-12")).toMatchObject({ current: 3, activeThisWeek: true });
  });

  it("does not break because the week in progress is still empty", () => {
    expect(computeStreak(["2026-10-05"], "2026-10-12").current).toBe(1);
  });

  it("ends when a week is missed and there is no freeze", () => {
    const s = computeStreak(["2026-09-14", "2026-09-21", "2026-10-05"], "2026-10-12");
    expect(s).toMatchObject({ current: 1, longest: 2 });
  });

  it("earns a freeze every four counted weeks, and a missed week spends it without adding", () => {
    const four = W.slice(0, 4); // 4 weeks in a row earns one freeze
    const s = computeStreak([...four, ...W.slice(5, 8)], "2026-10-12"); // skips 09-14, then 09-21..10-05
    expect(s.current).toBe(7);
    expect(s.frozenWeeks).toEqual(["2026-09-14"]);
    expect(s.freezes).toBe(0);
    expect(s.longest).toBe(7);
  });

  it("keeps at most two freezes", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => DateAdd("2026-01-05", i));
    expect(computeStreak(twelve, DateAdd("2026-01-05", 12)).freezes).toBe(2);
  });

  it("loses the streak when a second miss follows the only freeze", () => {
    const s = computeStreak([...W.slice(0, 4), W[6], W[7]], "2026-10-12"); // misses 09-14, 09-21; the freeze covers only one
    expect(s.current).toBe(2);
    expect(s.longest).toBe(4);
  });

  it("ignores weeks after this one", () => {
    expect(computeStreak(["2026-10-19"], "2026-10-12").current).toBe(0);
  });

  it("describes itself", () => {
    expect(streakLine({ current: 5, longest: 5, freezes: 1, activeThisWeek: true, frozenWeeks: [] })).toBe("5-week streak · 1 freeze saved");
    expect(streakLine({ current: 2, longest: 2, freezes: 0, activeThisWeek: true, frozenWeeks: [] })).toBe("2-week streak");
  });
});

function DateAdd(monday: string, weeks: number) {
  const d = new Date(`${monday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

describe("loadStreak", () => {
  beforeEach(async () => {
    await resetDb();
  });
  // Wednesday 2026-10-14 in Riyadh.
  const NOW = new Date("2026-10-14T12:00:00Z");
  const ZONE = "Asia/Riyadh";
  const log = (userId: string, at: string, minutes: number) => db.insert(progressLog).values({ userId, at: new Date(at), deltaUnits: 1, minutes });

  it("counts weeks by the person's own Monday", async () => {
    const u = await makeUser("Yousef");
    await log(u.id, "2026-10-14T10:00:00Z", 30);
    await log(u.id, "2026-10-07T10:00:00Z", 30);
    // Sunday 21:30 UTC is already Monday 00:30 in Riyadh, so it belongs to the week of 10-12, not 10-05.
    await log(u.id, "2026-10-11T21:30:00Z", 30);
    const s = await loadStreak(u.id, ZONE, NOW);
    expect(s).toMatchObject({ current: 2, activeThisWeek: true });
  });

  it("does not count a week whose taps were all undone", async () => {
    const u = await makeUser("Yousef");
    await log(u.id, "2026-10-07T10:00:00Z", 30);
    await log(u.id, "2026-10-07T11:00:00Z", -30);
    expect((await loadStreak(u.id, ZONE, NOW)).current).toBe(0);
  });

  it("counts finishing a title even with no taps", async () => {
    const u = await makeUser("Yousef");
    const row = await upsertItem({ category: "movie", source: "tmdb", externalId: "movie/1", title: "Dune", creator: null, year: 2021, coverUrl: null, summary: null, unit: "watch", totalUnits: 1, unitSeconds: 7200, genres: [], platforms: [] });
    const { entry: e } = await addEntry(u.id, row.id);
    await db.update(entry).set({ status: "done", progress: 1, finishedAt: new Date("2026-10-13T10:00:00Z") }).where(eq(entry.id, e.id));
    expect(await loadStreak(u.id, ZONE, NOW)).toMatchObject({ current: 1, activeThisWeek: true });
  });

  it("does not use another person's activity", async () => {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    await log(b.id, "2026-10-14T10:00:00Z", 60);
    expect((await loadStreak(a.id, ZONE, NOW)).current).toBe(0);
  });
});
