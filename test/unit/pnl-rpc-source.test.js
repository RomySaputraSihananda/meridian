import { describe, it, expect, vi } from "vitest";

vi.mock("../../state.js", () => ({
  getTrackedPosition: vi.fn(() => null),
  markOutOfRange: vi.fn(),
  markInRange: vi.fn(),
  minutesOutOfRange: vi.fn(() => 0),
}));

import { buildPosition } from "../../tools/pnl-rpc.js";

// A healthy position: deposited 100 USD worth, now holds 110 USD (+10%),
// priced normally, in range.
const HEALTHY = {
  position: "Pos1111111111111111111111111111111111111",
  pool: "Pool111111111111111111111111111111111111",
  baseMint: "Mint1111111111111111111111111111111111111",
  decX: 6,
  decY: 9,
  active: 10,
  lower: 0,
  upper: 20,
  xRaw: 50_000_000, // 50 tokens @ 6 decimals
  yRaw: 500_000_000, // 0.5 SOL @ 9 decimals
  feeXRaw: 0,
  feeYRaw: 0,
};
const PRICES = { "Mint1111111111111111111111111111111111111": 1 }; // $1/token
const SOL_USD = 130;
const METEORA = { allTimeDeposits: { total: { usd: 100 } }, allTimeWithdrawals: { total: { usd: 0 } }, allTimeFees: { total: { usd: 0 } } };

describe("tools/pnl-rpc.js buildPosition", () => {
  it("produces the same field shape getMyPositions() consumers expect", () => {
    const p = buildPosition(HEALTHY, PRICES, SOL_USD, METEORA, false);
    for (const key of [
      "position", "pool", "pair", "base_mint", "lower_bin", "upper_bin", "active_bin",
      "in_range", "unclaimed_fees_usd", "total_value_usd", "collected_fees_usd",
      "pnl_usd", "pnl_pct", "pnl_pct_derived", "pnl_pct_diff", "pnl_pct_suspicious",
      "fee_per_tvl_24h", "age_minutes", "minutes_out_of_range", "instruction",
    ]) {
      expect(p).toHaveProperty(key);
    }
  });

  it("computes a positive pnl_pct when balances exceed the deposit cost basis", () => {
    const p = buildPosition(HEALTHY, PRICES, SOL_USD, METEORA, false);
    // balances = 50*1 + 0.5*130 = 115 USD, deposits = 100 USD -> +15%
    expect(p.pnl_pct).toBeCloseTo(15, 1);
    expect(p.pnl_pct_suspicious).toBe(false);
  });

  it("flags pnl_pct_suspicious when the SOL price is unavailable (price outage)", () => {
    const p = buildPosition(HEALTHY, PRICES, null, METEORA, false);
    expect(p.pnl_pct_suspicious).toBe(true);
  });

  it("flags pnl_pct_suspicious when deposit history is missing (zero cost basis)", () => {
    const p = buildPosition(HEALTHY, PRICES, SOL_USD, null, false);
    expect(p.pnl_pct_suspicious).toBe(true);
  });

  it("marks in_range false when the active bin is outside [lower, upper]", () => {
    const outOfRange = { ...HEALTHY, active: 25 };
    const p = buildPosition(outOfRange, PRICES, SOL_USD, METEORA, false);
    expect(p.in_range).toBe(false);
  });
});
