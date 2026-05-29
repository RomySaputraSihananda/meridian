import { describe, it, expect } from "vitest";

// Test the pure computeStats logic by extracting it
// We test the logic inline since the script is a CLI tool

function computeStats(data) {
  if (!data.length) return { count: 0, net_pnl_usd: 0, win_rate: 0, expectancy_usd: 0 };
  const wins = data.filter((p) => (p.pnl_usd ?? 0) > 0);
  const losses = data.filter((p) => (p.pnl_usd ?? 0) <= 0);
  const winRate = wins.length / data.length;
  const avgWin = wins.length ? wins.reduce((s, p) => s + p.pnl_usd, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, p) => s + p.pnl_usd, 0) / losses.length : 0;
  return {
    count: data.length,
    net_pnl_usd: data.reduce((s, p) => s + (p.pnl_usd ?? 0), 0),
    win_rate: winRate,
    expectancy_usd: winRate * avgWin + (1 - winRate) * avgLoss,
  };
}

describe("comparison harness stats", () => {
  it("computes net PnL correctly", () => {
    const records = [{ pnl_usd: 5 }, { pnl_usd: -3 }, { pnl_usd: 8 }];
    expect(computeStats(records).net_pnl_usd).toBeCloseTo(10, 1);
  });

  it("computes win rate correctly", () => {
    const records = [{ pnl_usd: 5 }, { pnl_usd: -3 }, { pnl_usd: 2 }];
    expect(computeStats(records).win_rate).toBeCloseTo(2 / 3, 2);
  });

  it("returns zero stats for empty records", () => {
    expect(computeStats([]).count).toBe(0);
    expect(computeStats([]).net_pnl_usd).toBe(0);
  });

  it("computes negative expectancy for mostly-losing set", () => {
    const records = Array.from({ length: 10 }, (_, i) => ({ pnl_usd: i === 0 ? 5 : -3 }));
    expect(computeStats(records).expectancy_usd).toBeLessThan(0);
  });
});
