import { describe, it, expect } from "vitest";
import { computeBinsBelow } from "../../config.js";

const OPTS = { minBinsBelow: 35, maxBinsBelow: 69 };

describe("computeBinsBelow", () => {
  it("returns null for zero volatility", () => {
    expect(computeBinsBelow(0, OPTS)).toBeNull();
  });

  it("returns null for negative volatility", () => {
    expect(computeBinsBelow(-1, OPTS)).toBeNull();
  });

  it("returns null for non-finite values", () => {
    expect(computeBinsBelow(NaN, OPTS)).toBeNull();
    expect(computeBinsBelow(Infinity, OPTS)).toBeNull();
    expect(computeBinsBelow(null, OPTS)).toBeNull();
  });

  it("returns minBinsBelow for tiny positive volatility", () => {
    expect(computeBinsBelow(0.01, OPTS)).toBe(35);
  });

  it("returns maxBinsBelow for volatility >= 5", () => {
    expect(computeBinsBelow(5, OPTS)).toBe(69);
    expect(computeBinsBelow(10, OPTS)).toBe(69);
  });

  it("scales linearly between min and max", () => {
    const mid = computeBinsBelow(2.5, OPTS);
    // round(35 + (2.5/5) * 34) = round(35 + 17) = 52
    expect(mid).toBe(52);
  });

  it("clamps result to [minBinsBelow, maxBinsBelow]", () => {
    const lo = computeBinsBelow(0.001, { minBinsBelow: 35, maxBinsBelow: 69 });
    const hi = computeBinsBelow(99, { minBinsBelow: 35, maxBinsBelow: 69 });
    expect(lo).toBeGreaterThanOrEqual(35);
    expect(hi).toBeLessThanOrEqual(69);
  });
});
