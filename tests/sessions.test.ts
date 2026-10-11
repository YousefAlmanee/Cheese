import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

let failProgress = false;
vi.mock("@/lib/entries", async (orig) => {
  const real = await orig<typeof import("@/lib/entries")>();
  return {
    ...real,
    changeProgress: vi.fn(async (...args: Parameters<typeof real.changeProgress>) => {
      if (failProgress) throw new Error("database went away");
      return real.changeProgress(...args);
    }),
  };
});

import { db } from "@/db";
import { entry, planSession, progressLog } from "@/db/schema";
import { addEntry, upsertItem } from "@/lib/library";
import { bookSession, completeSession } from "@/lib/sessions";
import { makeUser, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  failProgress = false;
});

describe("completeSession when applying progress fails", () => {
  it("gives the session back so a retry still counts it", async () => {
    const me = await makeUser("Yousef");
    const it = await upsertItem({ category: "anime", source: "anilist", externalId: "1", title: "Frieren", creator: null, year: null, coverUrl: null, summary: null, unit: "episode", totalUnits: 28, unitSeconds: 1440, genres: [], platforms: [] });
    const { entry: e } = await addEntry(me.id, it.id);
    await db.update(entry).set({ status: "in_progress", progress: 7 }).where(eq(entry.id, e.id));
    const b = await bookSession(me.id, { itemId: it.id, title: "Frieren · 2 episodes", startsAt: new Date(Date.now() + 3600_000), durationMin: 48, units: 2 }, new Date());
    if (!b.ok) throw new Error("setup");

    failProgress = true;
    await expect(completeSession(me.id, b.session.id)).rejects.toThrow("database went away");
    expect((await db.select().from(planSession).where(eq(planSession.id, b.session.id)))[0].done).toBe(false);

    failProgress = false;
    await completeSession(me.id, b.session.id);
    expect((await db.select().from(entry).where(eq(entry.id, e.id)))[0].progress).toBe(9);
    expect(await db.select().from(progressLog).where(eq(progressLog.userId, me.id))).toHaveLength(1);
  });
});
