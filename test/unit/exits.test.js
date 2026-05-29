import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";

// ── Mutable in-memory state ───────────────────────────────────────────────────
// Using a ref object so the beforeEach closure always captures the latest value
// even after writeFileSync mutations within a single test.
const stateRef = { current: null };

function makeDefaultState() {
  return {
    positions: {
      PosAddr1: {
        position: "PosAddr1",
        pool: "PoolAddr1",
        closed: false,
        trailing_active: false,
        peak_pnl_pct: 0,
        out_of_range_since: null,
        confirmed_trailing_exit_until: null,
        confirmed_trailing_exit_reason: null,
      },
    },
    recentEvents: [],
    lastUpdated: null,
  };
}

// Re-install spies before every test so each test starts with a clean state.
beforeEach(() => {
  stateRef.current = makeDefaultState();

  vi.spyOn(fs, "existsSync").mockReturnValue(true);
  vi.spyOn(fs, "readFileSync").mockImplementation(() =>
    JSON.stringify(stateRef.current)
  );
  vi.spyOn(fs, "writeFileSync").mockImplementation((_path, data) => {
    // Only update stateRef when the call comes from state.js (JSON data with "positions" key).
    // logger.js routes through appendFileSync but spyOn may intercept internal calls too.
    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === "object" && "positions" in parsed) {
          stateRef.current = parsed;
        }
      } catch {
        // Non-JSON write (e.g. log lines) — ignore
      }
    }
  });
  // Silence appendFileSync so logger.js doesn't write to disk
  vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});
  vi.spyOn(fs, "mkdirSync").mockImplementation(() => {});
});

import { updatePnlAndCheckExits } from "../../state.js";

// ── Shared config ─────────────────────────────────────────────────────────────
const mgmtConfig = {
  stopLossPct: -10,
  takeProfitPct: 5,
  trailingTakeProfit: true,
  trailingTriggerPct: 3,
  trailingDropPct: 1.5,
  outOfRangeWaitMinutes: 30,
  minFeePerTvl24h: 7,
  minAgeBeforeYieldCheck: 60,
};

// Helper: override parts of the position in state before a test
function seedPosition(overrides) {
  Object.assign(stateRef.current.positions.PosAddr1, overrides);
}

// Convenience call wrapper
function call(posData) {
  return updatePnlAndCheckExits("PosAddr1", posData, mgmtConfig);
}

// =============================================================================
// Stop loss
// =============================================================================
describe("updatePnlAndCheckExits — stop loss", () => {
  it("fires STOP_LOSS when PnL is exactly at threshold", () => {
    const result = call({
      pnl_pct: -10,
      pnl_pct_suspicious: false,
      in_range: true,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    });
    expect(result?.action).toBe("STOP_LOSS");
  });

  it("fires STOP_LOSS when PnL is below threshold", () => {
    const result = call({
      pnl_pct: -15,
      pnl_pct_suspicious: false,
      in_range: true,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    });
    expect(result?.action).toBe("STOP_LOSS");
  });

  it("returns null when PnL is above stop-loss threshold", () => {
    const result = call({
      pnl_pct: -5,
      pnl_pct_suspicious: false,
      in_range: true,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    });
    expect(result).toBeNull();
  });

  it("uses derived PnL for stop-loss when suspicious and derived is present", () => {
    // Reported rosy value hides a deep loss — derived should trigger SL
    const result = call({
      pnl_pct: 2,
      pnl_pct_derived: -12,
      pnl_pct_suspicious: true,
      in_range: true,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    });
    expect(result?.action).toBe("STOP_LOSS");
    expect(result?.reason).toMatch(/sanity guard/i);
  });

  it("does NOT fire stop-loss when suspicious but no derived PnL and reported is above threshold", () => {
    // effectivePnlForSL falls back to currentPnlPct (-5%) which is above -10 SL
    const result = call({
      pnl_pct: -5,
      pnl_pct_derived: undefined,
      pnl_pct_suspicious: true,
      in_range: true,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    });
    expect(result?.action).not.toBe("STOP_LOSS");
  });

  it("does not fire stop-loss when stopLossPct is not configured", () => {
    const result = updatePnlAndCheckExits(
      "PosAddr1",
      {
        pnl_pct: -99,
        pnl_pct_suspicious: false,
        in_range: true,
        fee_per_tvl_24h: 8,
        age_minutes: 120,
      },
      { ...mgmtConfig, stopLossPct: null }
    );
    expect(result?.action).not.toBe("STOP_LOSS");
  });
});

// =============================================================================
// Trailing take-profit
// =============================================================================
describe("updatePnlAndCheckExits — trailing TP", () => {
  it("does not fire TRAILING_TP when PnL is below trailing trigger and trailing not active", () => {
    const result = call({
      pnl_pct: 1,
      pnl_pct_suspicious: false,
      in_range: true,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    });
    expect(result?.action).not.toBe("TRAILING_TP");
  });

  it("activates trailing_active when peak_pnl_pct reaches trailingTriggerPct", () => {
    // Pre-seed a confirmed peak above trigger
    seedPosition({ peak_pnl_pct: 4, trailing_active: false });

    // Call — should activate trailing_active (peak 4 >= trigger 3) but no drop yet
    const result = call({
      pnl_pct: 4, // still at peak, drop = 0 < trailingDropPct
      pnl_pct_suspicious: false,
      in_range: true,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    });
    // No sufficient drop → should not fire TRAILING_TP
    expect(result?.action).not.toBe("TRAILING_TP");
    // trailing_active should now be persisted as true
    expect(stateRef.current.positions.PosAddr1.trailing_active).toBe(true);
  });

  it("fires TRAILING_TP when trailing_active and drop exceeds trailingDropPct", () => {
    // Pre-seed: trailing already active with a confirmed peak
    seedPosition({ trailing_active: true, peak_pnl_pct: 5 });

    const result = call({
      pnl_pct: 3, // drop = 5 - 3 = 2 >= trailingDropPct (1.5)
      pnl_pct_suspicious: false,
      in_range: true,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    });
    expect(result?.action).toBe("TRAILING_TP");
    expect(result?.needs_confirmation).toBe(true);
    expect(result?.drop_from_peak_pct).toBeCloseTo(2);
  });

  it("does NOT fire TRAILING_TP when drop is below trailingDropPct", () => {
    seedPosition({ trailing_active: true, peak_pnl_pct: 5 });

    const result = call({
      pnl_pct: 4.2, // drop = 0.8 < 1.5
      pnl_pct_suspicious: false,
      in_range: true,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    });
    expect(result?.action).not.toBe("TRAILING_TP");
  });

  it("does NOT fire TRAILING_TP when PnL is suspicious (even if trailing active)", () => {
    seedPosition({ trailing_active: true, peak_pnl_pct: 5 });

    const result = call({
      pnl_pct: 3, // drop = 2 >= 1.5, but suspicious flag blocks it
      pnl_pct_suspicious: true,
      in_range: true,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    });
    // Trailing TP is guarded by !pnl_pct_suspicious in the implementation
    expect(result?.action).not.toBe("TRAILING_TP");
  });

  it("returns TRAILING_TP with confirmed_recheck when confirmed_trailing_exit_until is set and not expired", () => {
    // Simulate state left by resolvePendingTrailingDrop confirming a drop
    const future = new Date(Date.now() + 30_000).toISOString();
    seedPosition({
      confirmed_trailing_exit_until: future,
      confirmed_trailing_exit_reason:
        "Trailing TP: peak 5.00% → current 3.00% (dropped 2.00% >= 1.5%)",
    });

    const result = call({
      pnl_pct: 3,
      pnl_pct_suspicious: false,
      in_range: true,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    });
    expect(result?.action).toBe("TRAILING_TP");
    expect(result?.confirmed_recheck).toBe(true);
  });
});

// =============================================================================
// Out of range
// =============================================================================
describe("updatePnlAndCheckExits — out of range", () => {
  it("does not fire OOR exit on first out-of-range call (just marks the timestamp)", () => {
    // First call with in_range=false: sets out_of_range_since to now → no time elapsed yet
    const result = call({
      pnl_pct: 1,
      pnl_pct_suspicious: false,
      in_range: false,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    });
    expect(result?.action).not.toBe("OUT_OF_RANGE");
    // OOR timestamp must be recorded
    expect(stateRef.current.positions.PosAddr1.out_of_range_since).not.toBeNull();
  });

  it("fires OUT_OF_RANGE after wait time elapses", () => {
    // Pre-seed out_of_range_since to 31 minutes ago
    const past = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    seedPosition({ out_of_range_since: past });

    const result = call({
      pnl_pct: 1,
      pnl_pct_suspicious: false,
      in_range: false, // still OOR
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    });
    expect(result?.action).toBe("OUT_OF_RANGE");
    expect(result?.reason).toMatch(/out of range/i);
  });

  it("clears out_of_range_since when position comes back in range", () => {
    const past = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    seedPosition({ out_of_range_since: past });

    const result = call({
      pnl_pct: 1,
      pnl_pct_suspicious: false,
      in_range: true, // back in range
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    });
    expect(result?.action).not.toBe("OUT_OF_RANGE");
    expect(stateRef.current.positions.PosAddr1.out_of_range_since).toBeNull();
  });

  it("does not fire OOR when position is still within wait window", () => {
    const past = new Date(Date.now() - 29 * 60 * 1000).toISOString();
    seedPosition({ out_of_range_since: past });

    const result = call({
      pnl_pct: 1,
      pnl_pct_suspicious: false,
      in_range: false,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    });
    expect(result?.action).not.toBe("OUT_OF_RANGE");
  });
});

// =============================================================================
// Low yield
// =============================================================================
describe("updatePnlAndCheckExits — low yield", () => {
  it("fires LOW_YIELD when fee/TVL is below threshold after min age", () => {
    const result = call({
      pnl_pct: 1,
      pnl_pct_suspicious: false,
      in_range: true,
      fee_per_tvl_24h: 3, // below minFeePerTvl24h (7)
      age_minutes: 120, // above minAgeBeforeYieldCheck (60)
    });
    expect(result?.action).toBe("LOW_YIELD");
    expect(result?.reason).toMatch(/low yield/i);
  });

  it("does not fire LOW_YIELD before minAgeBeforeYieldCheck", () => {
    const result = call({
      pnl_pct: 1,
      pnl_pct_suspicious: false,
      in_range: true,
      fee_per_tvl_24h: 3,
      age_minutes: 30, // too young
    });
    expect(result?.action).not.toBe("LOW_YIELD");
  });

  it("does not fire LOW_YIELD when fee/TVL is exactly at threshold", () => {
    const result = call({
      pnl_pct: 1,
      pnl_pct_suspicious: false,
      in_range: true,
      fee_per_tvl_24h: 7, // exactly at minFeePerTvl24h — not strictly below
      age_minutes: 120,
    });
    expect(result?.action).not.toBe("LOW_YIELD");
  });

  it("does not fire LOW_YIELD when minFeePerTvl24h is not configured", () => {
    const result = updatePnlAndCheckExits(
      "PosAddr1",
      {
        pnl_pct: 1,
        pnl_pct_suspicious: false,
        in_range: true,
        fee_per_tvl_24h: 0,
        age_minutes: 120,
      },
      { ...mgmtConfig, minFeePerTvl24h: null }
    );
    expect(result?.action).not.toBe("LOW_YIELD");
  });

  it("does not fire LOW_YIELD when fee_per_tvl_24h is null", () => {
    const result = call({
      pnl_pct: 1,
      pnl_pct_suspicious: false,
      in_range: true,
      fee_per_tvl_24h: null,
      age_minutes: 120,
    });
    expect(result?.action).not.toBe("LOW_YIELD");
  });

  it("fires LOW_YIELD when age_minutes is null (treated as old enough)", () => {
    // Guard: age_minutes == null || age_minutes >= minAgeForYieldCheck
    // null satisfies the null check → yield check applies
    const result = call({
      pnl_pct: 1,
      pnl_pct_suspicious: false,
      in_range: true,
      fee_per_tvl_24h: 3,
      age_minutes: null,
    });
    expect(result?.action).toBe("LOW_YIELD");
  });
});

// =============================================================================
// Healthy position (no exit)
// =============================================================================
describe("updatePnlAndCheckExits — healthy position", () => {
  it("returns null for a healthy in-range position with good PnL and yield", () => {
    const result = call({
      pnl_pct: 2,
      pnl_pct_suspicious: false,
      in_range: true,
      fee_per_tvl_24h: 10, // above min
      age_minutes: 120,
    });
    expect(result).toBeNull();
  });

  it("returns null for a closed position regardless of data", () => {
    seedPosition({ closed: true });
    const result = call({
      pnl_pct: -99,
      pnl_pct_suspicious: false,
      in_range: false,
      fee_per_tvl_24h: 0,
      age_minutes: 999,
    });
    expect(result).toBeNull();
  });

  it("returns null for an unknown position address", () => {
    const result = updatePnlAndCheckExits(
      "UnknownAddr",
      {
        pnl_pct: -99,
        pnl_pct_suspicious: false,
        in_range: false,
        fee_per_tvl_24h: 0,
        age_minutes: 999,
      },
      mgmtConfig
    );
    expect(result).toBeNull();
  });
});

// =============================================================================
// Priority: stop-loss evaluated before trailing TP
// =============================================================================
describe("updatePnlAndCheckExits — exit priority", () => {
  it("stop-loss takes priority over trailing TP when both conditions are met", () => {
    // trailing active with high peak, but PnL is also below SL
    seedPosition({ trailing_active: true, peak_pnl_pct: 5 });

    const result = call({
      pnl_pct: -12, // below SL (-10) AND far below peak (drop 17 >= 1.5)
      pnl_pct_suspicious: false,
      in_range: true,
      fee_per_tvl_24h: 8,
      age_minutes: 120,
    });
    // Stop-loss check precedes trailing TP check in the implementation
    expect(result?.action).toBe("STOP_LOSS");
  });
});
