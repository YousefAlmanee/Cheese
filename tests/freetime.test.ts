import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { dayBounds, freeGapsForDay, isDay, localInstant, mergeIntervals, minutesOf, parseClock, parseLocal, subtractIntervals, weekDays, type Interval } from "@/lib/freetime";
import { buildCalendar, escapeText, fold } from "@/lib/ics";

const ZONE = "Asia/Riyadh"; // UTC+3, no daylight saving
const at = (day: string, hhmm: string, zone = ZONE) => {
  const [h, m] = hhmm.split(":").map(Number);
  return localInstant(zone, day, h * 60 + m);
};
const span = (day: string, a: string, b: string): Interval => ({ start: at(day, a), end: at(day, b) });
const show = (list: Interval[], zone = ZONE) =>
  list.map((i) => `${DateTime.fromMillis(i.start, { zone }).toFormat("HH:mm")}-${DateTime.fromMillis(i.end, { zone }).toFormat("HH:mm")}`);

describe("interval maths", () => {
  it("merges overlapping and touching spans", () => {
    expect(mergeIntervals([{ start: 5, end: 8 }, { start: 1, end: 3 }, { start: 3, end: 4 }, { start: 7, end: 10 }])).toEqual([{ start: 1, end: 4 }, { start: 5, end: 10 }]);
  });
  it("subtracts from the middle, the ends, and whole spans", () => {
    expect(subtractIntervals([{ start: 0, end: 10 }], [{ start: 3, end: 5 }])).toEqual([{ start: 0, end: 3 }, { start: 5, end: 10 }]);
    expect(subtractIntervals([{ start: 0, end: 10 }], [{ start: -5, end: 2 }, { start: 8, end: 20 }])).toEqual([{ start: 2, end: 8 }]);
    expect(subtractIntervals([{ start: 0, end: 10 }], [{ start: 0, end: 10 }])).toEqual([]);
    expect(subtractIntervals([{ start: 0, end: 10 }], [])).toEqual([{ start: 0, end: 10 }]);
  });
  it("ignores empty spans", () => {
    expect(mergeIntervals([{ start: 4, end: 4 }])).toEqual([]);
  });
});

describe("freeGapsForDay", () => {
  const day = "2026-10-16";
  const evening = [{ startMin: 20 * 60, endMin: 23 * 60 }];

  it("a usual window is free time", () => {
    expect(show(freeGapsForDay({ zone: ZONE, day, windows: evening }))).toEqual(["20:00-23:00"]);
  });

  it("a calendar event cuts the window", () => {
    const gaps = freeGapsForDay({ zone: ZONE, day, windows: evening, busy: [span(day, "21:00", "22:00")] });
    expect(show(gaps)).toEqual(["20:00-21:00", "22:00-23:00"]);
  });

  it("a booked session also takes the time", () => {
    const gaps = freeGapsForDay({ zone: ZONE, day, windows: evening, busy: [span(day, "20:00", "21:30")] });
    expect(show(gaps)).toEqual(["21:30-23:00"]);
  });

  it("adding free time for one date, and blocking some", () => {
    const gaps = freeGapsForDay({
      zone: ZONE, day, windows: evening,
      adds: [{ startMin: 14 * 60, endMin: 16 * 60 }],
      blocks: [{ startMin: 22 * 60, endMin: 23 * 60 }],
    });
    expect(show(gaps)).toEqual(["14:00-16:00", "20:00-22:00"]);
  });

  it("overlapping windows count once", () => {
    const gaps = freeGapsForDay({ zone: ZONE, day, windows: [{ startMin: 1200, endMin: 1320 }], adds: [{ startMin: 1260, endMin: 1380 }] });
    expect(show(gaps)).toEqual(["20:00-23:00"]);
  });

  it("drops gaps that are too short to use", () => {
    const gaps = freeGapsForDay({ zone: ZONE, day, windows: evening, busy: [span(day, "20:10", "22:50")] });
    expect(show(gaps)).toEqual([]); // 10 minutes before and 10 minutes after
    const keep = freeGapsForDay({ zone: ZONE, day, windows: evening, busy: [span(day, "20:10", "22:50")], minGapMin: 10 });
    expect(show(keep)).toEqual(["20:00-20:10", "22:50-23:00"]);
  });

  it("never offers time that has already passed", () => {
    const gaps = freeGapsForDay({ zone: ZONE, day, windows: evening, notBefore: at(day, "21:07") });
    expect(show(gaps)).toEqual(["21:10-23:00"]); // rounded up to the next five minutes
    expect(freeGapsForDay({ zone: ZONE, day, windows: evening, notBefore: at(day, "23:30") })).toEqual([]);
  });

  it("an event that spans the whole evening leaves nothing", () => {
    const busy = [{ start: at(day, "18:00"), end: at(day, "23:59") }];
    expect(freeGapsForDay({ zone: ZONE, day, windows: evening, busy })).toEqual([]);
  });

  it("an all-day event the day before does not matter", () => {
    const prev = [{ start: at("2026-10-15", "00:00"), end: at("2026-10-16", "00:00") }];
    expect(show(freeGapsForDay({ zone: ZONE, day, windows: evening, busy: prev }))).toEqual(["20:00-23:00"]);
  });

  it("minutesOf reports whole minutes", () => {
    expect(minutesOf(span(day, "20:00", "21:45"))).toBe(105);
  });
});

describe("daylight saving", () => {
  it("clocks go back in Berlin on 25 Oct 2026: a midnight to 04:00 window is five hours", () => {
    const gaps = freeGapsForDay({ zone: "Europe/Berlin", day: "2026-10-25", windows: [{ startMin: 0, endMin: 240 }] });
    expect(gaps).toHaveLength(1);
    expect(minutesOf(gaps[0])).toBe(300);
  });
  it("an evening window is the same length on a normal day", () => {
    const gaps = freeGapsForDay({ zone: "Europe/Berlin", day: "2026-10-24", windows: [{ startMin: 1200, endMin: 1380 }] });
    expect(minutesOf(gaps[0])).toBe(180);
  });
  it("clocks go forward in New York on 8 Mar 2026: a 01:00 to 04:00 window is two hours", () => {
    const gaps = freeGapsForDay({ zone: "America/New_York", day: "2026-03-08", windows: [{ startMin: 60, endMin: 240 }] });
    expect(minutesOf(gaps[0])).toBe(120);
  });
  it("a day is 25 hours long when clocks go back", () => {
    const b = dayBounds("Europe/Berlin", "2026-10-25");
    expect((b.end - b.start) / 3_600_000).toBe(25);
  });
});

describe("weekDays and parsing", () => {
  it("lists Sunday to Saturday around any day", () => {
    expect(weekDays("2026-10-16", "UTC", 0)).toEqual(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
    expect(weekDays("2026-10-11", "UTC", 0)[0]).toBe("2026-10-11"); // Sunday starts its own week
    expect(weekDays("2026-10-17", "UTC", 0)[0]).toBe("2026-10-11");
  });
  it("validates dates and clocks", () => {
    expect(isDay("2026-10-16")).toBe(true);
    expect(isDay("2026-13-40")).toBe(false);
    expect(isDay("tomorrow")).toBe(false);
    expect(parseClock("19:30")).toBe(1170);
    expect(parseClock("24:00")).toBe(1440);
    expect(parseClock("25:00")).toBeNull();
    expect(parseClock("9pm")).toBeNull();
  });
  it("turns a local date and time into the right instant", () => {
    expect(parseLocal("Asia/Riyadh", "2026-10-16", "21:00")?.toISOString()).toBe("2026-10-16T18:00:00.000Z");
    expect(parseLocal("Asia/Riyadh", "2026-10-16", "nope")).toBeNull();
    expect(parseLocal("Asia/Riyadh", "2026-10-16", "24:00")).toBeNull();
  });
});

describe("calendar feed (.ics)", () => {
  const ev = { uid: "abc@cheese", start: new Date("2026-10-16T18:00:00Z"), end: new Date("2026-10-16T19:12:00Z"), summary: "Frieren, ep 8; with Sara", description: "Anime\nBring snacks" };

  it("escapes commas, semicolons, backslashes and newlines", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    expect(escapeText("one\rtwo\r\nthree")).toBe("one\\ntwo\\nthree"); // a lone carriage return must not survive either
  });

  it("folds long lines at 75 bytes without splitting a character", () => {
    const long = "SUMMARY:" + "é".repeat(80);
    const folded = fold(long);
    for (const line of folded.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });

  it("builds a valid calendar with CRLF line ends", () => {
    const text = buildCalendar("Cheese", [ev], new Date("2026-10-11T00:00:00Z"));
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text).toContain("DTSTART:20261016T180000Z");
    expect(text).toContain("DTEND:20261016T191200Z");
    expect(text).toContain("DTSTAMP:20261011T000000Z");
    expect(text).toContain("SUMMARY:Frieren\\, ep 8\\; with Sara");
    expect(text).toContain("DESCRIPTION:Anime\\nBring snacks");
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(text.split("\r\n").every((l) => !l.includes("\n"))).toBe(true);
  });

  it("an empty plan is still a valid calendar", () => {
    const text = buildCalendar("Cheese", []);
    expect(text).not.toContain("VEVENT");
    expect(text).toContain("END:VCALENDAR");
  });
});
