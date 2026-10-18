import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => undefined) } }));

import { db } from "@/db";
import { entry, notification, planSession, profile, progressLog } from "@/db/schema";
import { addEntry, upsertItem } from "@/lib/library";
import { hasActivity, isRecapTime, recapSummary, sendWeeklyRecaps, weeklyRecap } from "@/lib/recap";
import { makeUser, resetDb } from "./helpers";

// 2026-10-18 is a Sunday. In Riyadh (UTC+3) 15:30Z is 18:30 that evening.
const SUNDAY_EVENING = new Date("2026-10-18T15:30:00Z");
const ZONE = "Asia/Riyadh";
const hoursBefore = (h: number, from = SUNDAY_EVENING) => new Date(from.getTime() - h * 3600_000);

beforeEach(async () => {
  await resetDb();
});

async function person(name: string, zone = ZONE, patch: Partial<typeof profile.$inferInsert> = {}) {
  const u = await makeUser(name);
  await db.update(profile).set({ timezone: zone, ...patch }).where(eq(profile.userId, u.id));
  return u;
}

const log = (userId: string, at: Date, minutes: number) => db.insert(progressLog).values({ userId, at, deltaUnits: 1, minutes });

async function finish(userId: string, title: string, finishedAt: Date) {
  const row = await upsertItem({
    category: "movie", source: "tmdb", externalId: `movie/${title}`, title, creator: null, year: 2020, coverUrl: null, summary: null,
    unit: "watch", totalUnits: 1, unitSeconds: 7200, genres: [], platforms: [],
  });
  const { entry: e } = await addEntry(userId, row.id);
  await db.update(entry).set({ status: "done", progress: 1, finishedAt }).where(eq(entry.id, e.id));
}

async function planned(userId: string, startsAt: Date, done: boolean) {
  await db.insert(planSession).values({ userId, title: "Dune · 40 pages", startsAt, durationMin: 60, done });
}

const notes = (userId: string) => db.select().from(notification).where(eq(notification.userId, userId));

describe("when a recap is due", () => {
  it("is Sunday from 18:00 in the person's own timezone", () => {
    expect(isRecapTime(SUNDAY_EVENING, ZONE)).toBe(true);
    expect(isRecapTime(new Date("2026-10-18T14:59:00Z"), ZONE)).toBe(false); // 17:59 Sunday
    expect(isRecapTime(new Date("2026-10-17T15:30:00Z"), ZONE)).toBe(false); // Saturday evening
    expect(isRecapTime(SUNDAY_EVENING, "America/New_York")).toBe(false); // 11:30 Sunday morning there
  });
});

describe("what the week contains", () => {
  it("adds up time, finished titles and sessions from Monday to now, and nothing from before", async () => {
    const u = await person("Yousef");
    await log(u.id, new Date("2026-10-18T10:00:00Z"), 90);
    await log(u.id, new Date("2026-10-13T10:00:00Z"), 60);
    await log(u.id, new Date("2026-10-11T10:00:00Z"), 500); // last week (Sunday 11 Oct)
    await finish(u.id, "Interstellar", new Date("2026-10-14T10:00:00Z"));
    await finish(u.id, "Old film", new Date("2026-10-05T10:00:00Z"));
    await planned(u.id, new Date("2026-10-15T17:00:00Z"), true);
    await planned(u.id, new Date("2026-10-16T17:00:00Z"), false);

    const r = await weeklyRecap(u.id, ZONE, SUNDAY_EVENING);
    expect(r).toMatchObject({ minutes: 150, finished: ["Interstellar"], sessionsPlanned: 2, sessionsDone: 1 });
    expect(recapSummary(r)).toBe("2h 30m logged · finished Interstellar · 1 of 2 planned sessions done");
  });

  it("never reports negative time when taps were undone", async () => {
    const u = await person("Yousef");
    await log(u.id, hoursBefore(5), -30);
    const r = await weeklyRecap(u.id, ZONE, SUNDAY_EVENING);
    expect(r.minutes).toBe(0);
    expect(hasActivity(r)).toBe(false);
  });

  it("does not leak another person's week", async () => {
    const a = await person("Yousef");
    const b = await person("Sara");
    await log(b.id, hoursBefore(5), 120);
    expect((await weeklyRecap(a.id, ZONE, SUNDAY_EVENING)).minutes).toBe(0);
  });
});

describe("sending", () => {
  it("sends one in-app notification pointing at the recap", async () => {
    const u = await person("Yousef");
    await log(u.id, hoursBefore(5), 45);
    expect(await sendWeeklyRecaps(SUNDAY_EVENING)).toEqual({ checked: 1, sent: 1 });
    const [n] = await notes(u.id);
    expect(n).toMatchObject({ type: "weekly_recap", title: "Your week", body: "45m logged", url: "/recap" });
  });

  it("sends nothing before Sunday 18:00", async () => {
    const u = await person("Yousef");
    const early = new Date("2026-10-18T14:00:00Z");
    await log(u.id, hoursBefore(5, early), 45);
    expect(await sendWeeklyRecaps(early)).toEqual({ checked: 0, sent: 0 });
    expect(await notes(u.id)).toHaveLength(0);
  });

  it("sends once per week, however often the job runs", async () => {
    const u = await person("Yousef");
    await log(u.id, hoursBefore(5), 45);
    await sendWeeklyRecaps(SUNDAY_EVENING);
    const later = new Date(SUNDAY_EVENING.getTime() + 5 * 60_000);
    expect((await sendWeeklyRecaps(later)).sent).toBe(0);
    expect(await notes(u.id)).toHaveLength(1);
  });

  it("does not double send when two runs overlap", async () => {
    const u = await person("Yousef");
    await log(u.id, hoursBefore(5), 45);
    await Promise.all([sendWeeklyRecaps(SUNDAY_EVENING), sendWeeklyRecaps(SUNDAY_EVENING)]);
    expect(await notes(u.id)).toHaveLength(1);
  });

  it("sends again the next week", async () => {
    const u = await person("Yousef");
    await log(u.id, hoursBefore(5), 45);
    await sendWeeklyRecaps(SUNDAY_EVENING);
    const nextSunday = new Date(SUNDAY_EVENING.getTime() + 7 * 24 * 3600_000);
    await log(u.id, hoursBefore(5, nextSunday), 30);
    expect((await sendWeeklyRecaps(nextSunday)).sent).toBe(1);
    expect(await notes(u.id)).toHaveLength(2);
  });

  it("skips a quiet week, and still sends if something happens later that Sunday", async () => {
    const u = await person("Yousef");
    expect(await sendWeeklyRecaps(SUNDAY_EVENING)).toEqual({ checked: 1, sent: 0 });
    expect(await notes(u.id)).toHaveLength(0);
    const [p] = await db.select().from(profile).where(eq(profile.userId, u.id));
    expect(p.lastRecapAt).toBeNull();

    const later = new Date(SUNDAY_EVENING.getTime() + 60 * 60_000);
    await log(u.id, later, 20);
    expect((await sendWeeklyRecaps(new Date(later.getTime() + 60_000))).sent).toBe(1);
  });

  it("respects the off switch", async () => {
    const u = await person("Yousef", ZONE, { recapEnabled: false });
    await log(u.id, hoursBefore(5), 45);
    expect(await sendWeeklyRecaps(SUNDAY_EVENING)).toEqual({ checked: 0, sent: 0 });
    expect(await notes(u.id)).toHaveLength(0);
  });

  it("uses each person's own timezone", async () => {
    const riyadh = await person("Yousef", ZONE);
    const newYork = await person("Sara", "America/New_York");
    await log(riyadh.id, hoursBefore(5), 45);
    await log(newYork.id, hoursBefore(5), 45);
    expect((await sendWeeklyRecaps(SUNDAY_EVENING)).sent).toBe(1);
    expect(await notes(riyadh.id)).toHaveLength(1);
    expect(await notes(newYork.id)).toHaveLength(0);
  });
});
