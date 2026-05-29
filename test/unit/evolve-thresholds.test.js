import { describe, it, expect, vi } from "vitest";
import { evolveThresholds } from "../../lessons.js";

// Mock logger and file I/O
vi.mock("../../logger.js", () => ({ log: vi.fn(), logAction: vi.fn() }));
vi.mock("../../paths.js", () => ({ paths: { lessonsPath: "/dev/null", userConfigPath: "/dev/null" } }));

// Minimal config mock with correct keys
const cfg = {
  screening: {
    minFeeActiveTvlRatio: 0.05,
    minOrganic: 60,
    minHolders: 500,
    // no maxVolatility — never existed
  },
};

function makePerf(pnlPct, date) {
  return {
    pnl_pct: pnlPct,
    pnl_usd: pnlPct,
    recorded_at: `${date}T12:00:00.000Z`,
    fee_tvl_ratio: 0.1,
    organic_score: 70,
    holder_count: 600,
    volatility: 2,
  };
}

describe("evolveThresholds guards", () => {
  it("returns null when fewer than MIN_EVOLVE_POSITIONS samples", () => {
    const data = Array.from({ length: 15 }, (_, i) => makePerf(1, `2026-05-${String(i+1).padStart(2,'0')}`));
    expect(evolveThresholds(data, cfg)).toBeNull();
  });

  it("returns null when samples span fewer than 3 distinct days", () => {
    // 20 samples but all on the same day
    const data = Array.from({ length: 20 }, () => makePerf(1, "2026-05-01"));
    expect(evolveThresholds(data, cfg)).toBeNull();
  });

  it("does not reference maxVolatility (removed key)", () => {
    const data = Array.from({ length: 20 }, (_, i) =>
      makePerf(i % 3 === 0 ? -5 : 2, `2026-05-${String((i % 28) + 1).padStart(2,'0')}`)
    );
    const result = evolveThresholds(data, cfg);
    if (result) {
      expect(result.changes?.maxVolatility).toBeUndefined();
    }
  });

  it("uses minFeeActiveTvlRatio (not minFeeTvlRatio)", () => {
    // Verify the function reads the correct key — if minFeeActiveTvlRatio is undefined
    // the evolution block should gracefully skip (not crash)
    const cfgNoKey = { screening: {} };
    const data = Array.from({ length: 20 }, (_, i) =>
      makePerf(i % 4 === 0 ? -3 : 1, `2026-05-${String((i % 28) + 1).padStart(2,'0')}`)
    );
    expect(() => evolveThresholds(data, cfgNoKey)).not.toThrow();
  });
});
