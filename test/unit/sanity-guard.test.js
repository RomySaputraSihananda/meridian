import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";

const MOCK_STATE = JSON.stringify({
  positions: {
    "PosAddr1": {
      position: "PosAddr1",
      pool: "PoolAddr1",
      closed: false,
      trailing_active: false,
      peak_pnl_pct: null,
      out_of_range_since: null,
    }
  },
  recentEvents: [],
  lastUpdated: null,
});

// Spy on fs before state.js is imported — hoisted vi.mock is not needed
// because we set up spies in beforeEach which runs before each test body.
// However, state.js is a module that imports fs at parse time.
// We use vi.spyOn to intercept calls on the shared fs object.

beforeEach(() => {
  vi.spyOn(fs, "existsSync").mockReturnValue(true);
  vi.spyOn(fs, "readFileSync").mockReturnValue(MOCK_STATE);
  vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
});

import { updatePnlAndCheckExits } from "../../state.js";

describe("F1: pnl sanity guard precedence", () => {
  const mgmtConfig = {
    stopLossPct: -5,
    takeProfitPct: 10,
    trailingTakeProfit: true,
    trailingTriggerPct: 3,
    trailingDropPct: 1.5,
    outOfRangeWaitMinutes: 30,
    minFeePerTvl24h: 7,
    minAgeBeforeYieldCheck: 60,
  };

  it("fires stop-loss using derived PnL when sanity guard is active", () => {
    // Reported: +0.36% (rosy), Derived: -8.74% (below stopLoss of -5%)
    const result = updatePnlAndCheckExits("PosAddr1", {
      pnl_pct: 0.36,           // reported (rosy, distrusted)
      pnl_pct_derived: -8.74,  // conservative (below stop-loss)
      pnl_pct_suspicious: true,
      in_range: true,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    }, mgmtConfig);

    // Must trigger STOP_LOSS using the derived figure
    expect(result).not.toBeNull();
    expect(result?.action).toBe("STOP_LOSS");
  });

  it("does NOT produce healthy/null when sanity guard fires and derived is below stop-loss", () => {
    const result = updatePnlAndCheckExits("PosAddr1", {
      pnl_pct: 0.36,
      pnl_pct_derived: -8.74,
      pnl_pct_suspicious: true,
      in_range: true,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    }, mgmtConfig);

    expect(result?.action).not.toBeUndefined(); // cannot return null (healthy)
  });

  it("normal stop-loss still works when no sanity flag", () => {
    const result = updatePnlAndCheckExits("PosAddr1", {
      pnl_pct: -6,
      pnl_pct_suspicious: false,
      in_range: true,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    }, mgmtConfig);
    expect(result?.action).toBe("STOP_LOSS");
  });

  it("returns null (healthy) when sanity guard fires but derived PnL is above stop-loss", () => {
    // Derived is -2% which is above stopLoss of -5% — should NOT close
    const result = updatePnlAndCheckExits("PosAddr1", {
      pnl_pct: 3.0,
      pnl_pct_derived: -2.0, // above stop-loss, no exit
      pnl_pct_suspicious: true,
      in_range: true,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    }, mgmtConfig);
    expect(result).toBeNull(); // healthy — no exit
  });
});
