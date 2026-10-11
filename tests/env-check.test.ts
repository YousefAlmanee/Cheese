import { describe, expect, it } from "vitest";
import { secretProblem } from "@/lib/env-check";

describe("secretProblem", () => {
  it("accepts a long random secret", () => {
    expect(secretProblem("q3Zr8vB1nK5xT0yL7mW2cH9dJ4fG6aSe+u/PoIbE")).toBeNull();
  });
  it("refuses a missing or short one", () => {
    expect(secretProblem(undefined)).toMatch(/at least 32/);
    expect(secretProblem("short")).toMatch(/at least 32/);
  });
  it("refuses the placeholder from .env.example, even though it is long enough", () => {
    expect(secretProblem("change-me-to-a-long-random-string")).toMatch(/placeholder/);
  });
});
