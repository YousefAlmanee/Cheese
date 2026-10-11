import { describe, expect, it } from "vitest";
import { isValidUsername, usernameBase, usernameCandidates } from "@/lib/username";
import { safeNext } from "@/lib/safe-next";

describe("usernameBase", () => {
  it("lowercases and strips accents and symbols", () => {
    expect(usernameBase("Yousef Almanee")).toBe("yousef_almanee");
    expect(usernameBase("Zoë O'Neil")).toBe("zoe_o_neil");
  });
  it("uses the part before @ for emails", () => {
    expect(usernameBase("sara.k@example.com")).toBe("sara_k");
  });
  it("pads short or empty results so they are valid", () => {
    expect(isValidUsername(usernameBase("Al"))).toBe(true);
    expect(isValidUsername(usernameBase("!!!"))).toBe(true);
    expect(isValidUsername(usernameBase("محمد"))).toBe(true);
  });
});

describe("usernameCandidates", () => {
  it("tries the plain base first, then numbered ones", () => {
    const it = usernameCandidates("sara", () => 0.5);
    expect(it.next().value).toBe("sara");
    expect(it.next().value).toBe("sara550");
  });
  it("always produces valid handles", () => {
    for (const c of usernameCandidates("yousef_almanee", () => 0.99)) expect(isValidUsername(c)).toBe(true);
  });
});

describe("safeNext", () => {
  it("keeps same-site paths", () => expect(safeNext("/plan?day=2026-10-17")).toBe("/plan?day=2026-10-17"));
  it("blocks open redirects", () => {
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/\t/evil.example")).toBe("/"); // browsers strip the tab, leaving //evil.example
    expect(safeNext("/\n/evil.example")).toBe("/");
    expect(safeNext("/ok\\..\\evil")).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });
});
