import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkCircuitBreakers, resetDailyStats, recordTrade, getDailyStats } from "../../risk.js";

const cfg = { risk: { maxDailyLossSol: 5, maxConsecutiveLosses: 3 } };

beforeEach(() => {
  resetDailyStats();
  vi.unstubAllEnvs();
});

describe("checkCircuitBreakers", () => {
  it("passes when no limits are hit", () => {
    const result = checkCircuitBreakers(cfg);
    expect(result.blocked).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("blocks when daily loss exceeds maxDailyLossSol", () => {
    recordTrade({ pnlSol: -3 });
    recordTrade({ pnlSol: -2.5 });
    const result = checkCircuitBreakers(cfg);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/daily loss/i);
  });

  it("blocks when consecutive losses hit limit", () => {
    recordTrade({ pnlSol: -0.1 });
    recordTrade({ pnlSol: -0.1 });
    recordTrade({ pnlSol: -0.1 });
    const result = checkCircuitBreakers(cfg);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/consecutive/i);
  });

  it("resets consecutive count on a win", () => {
    recordTrade({ pnlSol: -0.1 });
    recordTrade({ pnlSol: -0.1 });
    recordTrade({ pnlSol: 0.5 }); // win resets counter
    recordTrade({ pnlSol: -0.1 });
    const result = checkCircuitBreakers(cfg);
    expect(result.blocked).toBe(false); // only 1 consecutive loss now
  });

  it("blocks on MERIDIAN_KILL_SWITCH=1", () => {
    vi.stubEnv("MERIDIAN_KILL_SWITCH", "1");
    const result = checkCircuitBreakers(cfg);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/kill.?switch/i);
  });

  it("passes with no config (uses Infinity defaults)", () => {
    for (let i = 0; i < 10; i++) recordTrade({ pnlSol: -1 });
    const result = checkCircuitBreakers({});
    expect(result.blocked).toBe(false);
  });
});

describe("recordTrade + getDailyStats", () => {
  it("tracks daily loss correctly", () => {
    recordTrade({ pnlSol: -2 });
    recordTrade({ pnlSol: -1.5 });
    const stats = getDailyStats();
    expect(stats.dailyLossSol).toBeCloseTo(3.5);
    expect(stats.tradesCount).toBe(2);
  });

  it("tracks daily gain correctly", () => {
    recordTrade({ pnlSol: 1.5 });
    const stats = getDailyStats();
    expect(stats.dailyGainSol).toBeCloseTo(1.5);
    expect(stats.consecutiveLosses).toBe(0);
  });
});
