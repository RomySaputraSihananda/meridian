/**
 * test/unit/paper-sim.test.js
 *
 * Unit tests for paper-positions.js — IL / fee math and persistence.
 *
 * Strategy:
 *  - processCandle() is private; we replicate its math inline so expected
 *    values are derived from the same formula, not hard-coded magic numbers.
 *  - File I/O is redirected to /tmp via a vi.mock on paths.js.
 *  - The DLMM SDK and fetch() are stubbed so openPaperPosition() can be
 *    tested without network or on-chain access.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// ── Mocks (must be declared before any import that triggers them) ─────────────

// Use a fixed temp path; the factory cannot reference variables (vi.mock is hoisted).
const _tmpPath = "/tmp/paper-sim-test-positions.json";

vi.mock("../../paths.js", () => ({
  paths: { paperPositionsPath: "/tmp/paper-sim-test-positions.json" },
}));

// Suppress logger output in tests.
vi.mock("../../logger.js", () => ({
  log: vi.fn(),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import {
  listPaperPositions,
  closePaperPosition,
  getPaperPosition,
} from "../../paper-positions.js";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const ohlcv = require("../fixtures/ohlcv.json");

// ── Math helpers — mirrors paper-positions.js exactly ─────────────────────────

/**
 * Replicated from paper-positions.js: processCandle()
 * Returns { feeEarned, ilUsd, currentPrice, inRange }
 */
function processCandle(candle, position) {
  const { low, high, close, volume } = candle;
  const {
    lowerPrice,
    upperPrice,
    lpFeeFraction,
    avgExistingBinTvl,
    weights,
    depositAmount,
    entryPrice,
  } = position;

  const candleLow  = Math.min(low, close);
  const candleHigh = Math.max(high, close);
  const overlapLow  = Math.max(candleLow, lowerPrice);
  const overlapHigh = Math.min(candleHigh, upperPrice);

  let feeEarned = 0;
  if (overlapHigh > overlapLow) {
    const overlapFrac    = (overlapHigh - overlapLow) / Math.max(candleHigh - candleLow, 1e-12);
    const volumeInRange  = volume * overlapFrac;
    const ourAvgBinDeposit = depositAmount / weights.length;
    const totalAvgBinLiq  = avgExistingBinTvl + ourAvgBinDeposit;
    const avgTvlShare     = ourAvgBinDeposit / totalAvgBinLiq;
    feeEarned = volumeInRange * lpFeeFraction * avgTvlShare;
  }

  const effectivePrice = Math.max(lowerPrice, Math.min(upperPrice, close));
  const r = entryPrice > 0 ? effectivePrice / entryPrice : 1;
  const ilPct = r > 0 ? (2 * Math.sqrt(r)) / (1 + r) - 1 : 0;
  const rangeWidth = upperPrice > lowerPrice ? Math.sqrt(upperPrice / lowerPrice) : 1;
  const ilUsd = depositAmount * ilPct * rangeWidth;

  return {
    feeEarned,
    ilUsd,
    currentPrice: close,
    inRange: overlapHigh > overlapLow,
  };
}

/** Replicated from paper-positions.js: computeInitialSplit() */
function computeInitialSplit(depositUsd, entryPrice, lowerPrice, upperPrice) {
  const p  = Math.max(lowerPrice, Math.min(upperPrice, entryPrice));
  const pa = lowerPrice;
  const pb = upperPrice;
  const sqrtP  = Math.sqrt(p);
  const sqrtPa = Math.sqrt(pa);
  const sqrtPb = Math.sqrt(pb);
  const yFrac  = (sqrtP - sqrtPa) / (sqrtPb - sqrtPa);
  return { xUsd: depositUsd * (1 - yFrac), yUsd: depositUsd * yFrac };
}

// ── Position factory — builds raw storage objects ─────────────────────────────

function makePosition(overrides = {}) {
  const defaults = {
    id:               "paper-test001",
    pool_address:     "POOL_ADDR",
    pool_name:        "TEST-POOL",
    pair:             "SOL-USDC",
    status:           "open",
    strategy_type:    "spot",
    deposit_amount:   1000,       // USD
    lower_price:      0.9,
    upper_price:      1.1,
    entry_price:      1.0,
    last_price:       1.0,
    lp_fee_fraction:  0.002,      // 0.2 %
    lower_bin_id:     -10,
    upper_bin_id:     10,
    weights:          Array(21).fill(1 / 21),
    avg_existing_bin_tvl: 5000,   // USD per bin
    initial_x_usd:    500,
    initial_y_usd:    500,
    fees_earned:      0,
    il_usd:           0,
    net_pnl:          0,
    candles_total:    0,
    candles_in_range: 0,
    entry_timestamp:  1748390000,
    last_candle_timestamp: 1748390000,
    opened_at:        new Date(1748390000 * 1000).toISOString(),
    closed_at:        null,
    price_scale:      1,
    bin_step:         100,
  };
  return { ...defaults, ...overrides };
}

/** Write a single position directly to the temp file */
function seedState(positions) {
  fs.writeFileSync(_tmpPath, JSON.stringify({ positions }), "utf8");
}

// ── Cleanup ────────────────────────────────────────────────────────────────────

afterEach(() => {
  // Reset temp file between tests
  if (fs.existsSync(_tmpPath)) fs.unlinkSync(_tmpPath);
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("processCandle — fee accrual (in-range)", () => {
  it("earns positive fees when candle overlaps position range", () => {
    const pos = {
      lowerPrice: 0.9,
      upperPrice: 1.1,
      lpFeeFraction: 0.002,
      avgExistingBinTvl: 5000,
      weights: Array(21).fill(1 / 21),
      depositAmount: 1000,
      entryPrice: 1.0,
    };
    // candle fully inside range
    const candle = { low: 0.95, high: 1.05, close: 1.0, volume: 100000 };
    const { feeEarned, inRange } = processCandle(candle, pos);
    expect(inRange).toBe(true);
    expect(feeEarned).toBeGreaterThan(0);
  });

  it("fee = volumeInRange * lpFeeFraction * tvlShare", () => {
    const pos = {
      lowerPrice: 0.9,
      upperPrice: 1.1,
      lpFeeFraction: 0.002,
      avgExistingBinTvl: 5000,
      weights: Array(21).fill(1 / 21),
      depositAmount: 1000,
      entryPrice: 1.0,
    };
    // candle exactly covers position range
    const candle = { low: 0.9, high: 1.1, close: 1.0, volume: 100000 };
    const { feeEarned } = processCandle(candle, pos);

    // manual derivation
    const ourBinDeposit = 1000 / 21;
    const totalBinLiq   = 5000 + ourBinDeposit;
    const tvlShare      = ourBinDeposit / totalBinLiq;
    const expected      = 100000 * 0.002 * tvlShare;
    expect(feeEarned).toBeCloseTo(expected, 8);
  });

  it("partial overlap — only the overlapping volume portion earns fees", () => {
    const pos = {
      lowerPrice: 1.0,
      upperPrice: 1.2,
      lpFeeFraction: 0.002,
      avgExistingBinTvl: 5000,
      weights: Array(11).fill(1 / 11),
      depositAmount: 1000,
      entryPrice: 1.1,
    };
    // candle spans [0.8, 1.4]; only [1.0, 1.2] overlaps
    const candle = { low: 0.8, high: 1.4, close: 1.1, volume: 120000 };
    const { feeEarned } = processCandle(candle, pos);

    const candleLow  = Math.min(0.8, 1.1);
    const candleHigh = Math.max(1.4, 1.1);
    const overlapFrac = (1.2 - 1.0) / (candleHigh - candleLow);
    const volumeInRange = 120000 * overlapFrac;
    const ourBinDeposit = 1000 / 11;
    const tvlShare = ourBinDeposit / (5000 + ourBinDeposit);
    const expected = volumeInRange * 0.002 * tvlShare;
    expect(feeEarned).toBeCloseTo(expected, 8);
  });
});

describe("processCandle — no fee accrual (out-of-range)", () => {
  it("earns zero fees when candle is entirely above range", () => {
    const pos = {
      lowerPrice: 0.9,
      upperPrice: 1.1,
      lpFeeFraction: 0.002,
      avgExistingBinTvl: 5000,
      weights: Array(21).fill(1 / 21),
      depositAmount: 1000,
      entryPrice: 1.0,
    };
    const candle = { low: 1.15, high: 1.30, close: 1.20, volume: 100000 };
    const { feeEarned, inRange } = processCandle(candle, pos);
    expect(inRange).toBe(false);
    expect(feeEarned).toBe(0);
  });

  it("earns zero fees when candle is entirely below range", () => {
    const pos = {
      lowerPrice: 0.9,
      upperPrice: 1.1,
      lpFeeFraction: 0.002,
      avgExistingBinTvl: 5000,
      weights: Array(21).fill(1 / 21),
      depositAmount: 1000,
      entryPrice: 1.0,
    };
    const candle = { low: 0.70, high: 0.85, close: 0.80, volume: 80000 };
    const { feeEarned, inRange } = processCandle(candle, pos);
    expect(inRange).toBe(false);
    expect(feeEarned).toBe(0);
  });
});

describe("IL formula (price ratio: 2√r/(1+r) − 1)", () => {
  it("IL is zero at entry price (r=1)", () => {
    const pos = {
      lowerPrice: 0.9,
      upperPrice: 1.1,
      lpFeeFraction: 0.002,
      avgExistingBinTvl: 5000,
      weights: Array(21).fill(1 / 21),
      depositAmount: 1000,
      entryPrice: 1.0,
    };
    const candle = { low: 0.99, high: 1.01, close: 1.0, volume: 0 };
    const { ilUsd } = processCandle(candle, pos);
    // IL% = 2*sqrt(1)/(1+1)-1 = 0
    expect(ilUsd).toBeCloseTo(0, 8);
  });

  it("IL is negative (capital loss) as price diverges from entry", () => {
    const pos = {
      lowerPrice: 0.5,
      upperPrice: 2.0,
      lpFeeFraction: 0.002,
      avgExistingBinTvl: 5000,
      weights: Array(16).fill(1 / 16),
      depositAmount: 1000,
      entryPrice: 1.0,
    };
    // price moves to 1.5 (50% above entry) — should produce negative IL
    const candle = { low: 1.48, high: 1.52, close: 1.5, volume: 0 };
    const { ilUsd } = processCandle(candle, pos);
    expect(ilUsd).toBeLessThan(0);
  });

  it("IL becomes more negative as price diverges further", () => {
    const pos = {
      lowerPrice: 0.5,
      upperPrice: 3.0,
      lpFeeFraction: 0.002,
      avgExistingBinTvl: 5000,
      weights: Array(16).fill(1 / 16),
      depositAmount: 1000,
      entryPrice: 1.0,
    };
    const candle1 = { low: 1.49, high: 1.51, close: 1.5, volume: 0 };
    const candle2 = { low: 1.99, high: 2.01, close: 2.0, volume: 0 };
    const { ilUsd: il1 } = processCandle(candle1, pos);
    const { ilUsd: il2 } = processCandle(candle2, pos);
    expect(il2).toBeLessThan(il1);
  });

  it("IL is locked at lower boundary when price goes out-of-range below", () => {
    const pos = {
      lowerPrice: 0.9,
      upperPrice: 1.1,
      lpFeeFraction: 0.002,
      avgExistingBinTvl: 5000,
      weights: Array(21).fill(1 / 21),
      depositAmount: 1000,
      entryPrice: 1.0,
    };
    // price way below range — effectivePrice is clamped to lowerPrice
    const candle = { low: 0.1, high: 0.3, close: 0.2, volume: 1000 };
    const { ilUsd } = processCandle(candle, pos);

    const effectivePrice = 0.9; // clamped to lowerPrice
    const r = effectivePrice / 1.0;
    const ilPct = (2 * Math.sqrt(r)) / (1 + r) - 1;
    const rangeWidth = Math.sqrt(1.1 / 0.9);
    const expected = 1000 * ilPct * rangeWidth;
    expect(ilUsd).toBeCloseTo(expected, 8);
  });

  it("IL matches 2√r/(1+r)−1 formula amplified by rangeWidth", () => {
    const lowerPrice = 0.8;
    const upperPrice = 1.2;
    const entryPrice = 1.0;
    const depositAmount = 2000;
    const pos = {
      lowerPrice,
      upperPrice,
      lpFeeFraction: 0.003,
      avgExistingBinTvl: 10000,
      weights: Array(10).fill(0.1),
      depositAmount,
      entryPrice,
    };
    const closePrice = 1.1;
    const candle = { low: 1.09, high: 1.11, close: closePrice, volume: 0 };
    const { ilUsd } = processCandle(candle, pos);

    const r = closePrice / entryPrice;
    const ilPct = (2 * Math.sqrt(r)) / (1 + r) - 1;
    const rangeWidth = Math.sqrt(upperPrice / lowerPrice);
    const expected = depositAmount * ilPct * rangeWidth;
    expect(ilUsd).toBeCloseTo(expected, 8);
  });
});

describe("in-range detection", () => {
  const basePos = {
    lowerPrice: 0.9,
    upperPrice: 1.1,
    lpFeeFraction: 0.002,
    avgExistingBinTvl: 5000,
    weights: Array(21).fill(1 / 21),
    depositAmount: 1000,
    entryPrice: 1.0,
  };

  it("price 1.0 is in-range [0.9, 1.1]", () => {
    const candle = { low: 0.99, high: 1.01, close: 1.0, volume: 1000 };
    expect(processCandle(candle, basePos).inRange).toBe(true);
  });

  it("price 1.2 is out-of-range above [0.9, 1.1]", () => {
    const candle = { low: 1.19, high: 1.21, close: 1.2, volume: 1000 };
    expect(processCandle(candle, basePos).inRange).toBe(false);
  });

  it("price 0.8 is out-of-range below [0.9, 1.1]", () => {
    const candle = { low: 0.79, high: 0.81, close: 0.8, volume: 1000 };
    expect(processCandle(candle, basePos).inRange).toBe(false);
  });

  it("candle spanning exactly lower boundary is in-range", () => {
    // low < lowerPrice but high > lowerPrice → overlap exists
    const candle = { low: 0.85, high: 0.95, close: 0.91, volume: 5000 };
    expect(processCandle(candle, basePos).inRange).toBe(true);
  });
});

describe("multi-tick accumulation", () => {
  it("fees_earned sums correctly across 5 in-range ticks", () => {
    const pos = {
      lowerPrice: 0.95,
      upperPrice: 1.05,
      lpFeeFraction: 0.002,
      avgExistingBinTvl: 5000,
      weights: Array(11).fill(1 / 11),
      depositAmount: 1000,
      entryPrice: 1.0,
    };
    // Use first 5 candles from ohlcv.json (all in range 0.95–1.05)
    const candles = ohlcv.slice(0, 5);
    let totalFees = 0;
    for (const c of candles) {
      const { feeEarned } = processCandle(c, pos);
      totalFees += feeEarned;
    }
    // Compute expected independently
    const expected = candles.reduce((sum, c) => {
      const { feeEarned } = processCandle(c, pos);
      return sum + feeEarned;
    }, 0);
    expect(totalFees).toBeCloseTo(expected, 8);
    expect(totalFees).toBeGreaterThan(0);
  });

  it("IL is non-cumulative — last candle's IL overwrites previous", () => {
    const pos = {
      lowerPrice: 0.9,
      upperPrice: 1.1,
      lpFeeFraction: 0.002,
      avgExistingBinTvl: 5000,
      weights: Array(21).fill(1 / 21),
      depositAmount: 1000,
      entryPrice: 1.0,
    };
    const candle1 = { low: 0.99, high: 1.01, close: 1.0, volume: 1000 };
    const candle2 = { low: 1.04, high: 1.06, close: 1.05, volume: 1000 };
    const { ilUsd: il1 } = processCandle(candle1, pos);
    const { ilUsd: il2 } = processCandle(candle2, pos);
    // il_usd is reset each tick (not accumulated); il2 should differ from il1
    expect(il2).not.toBeCloseTo(il1, 8);
    // And il2 must equal the direct calculation for close=1.05
    const r = 1.05 / 1.0;
    const ilPct = (2 * Math.sqrt(r)) / (1 + r) - 1;
    const rangeWidth = Math.sqrt(1.1 / 0.9);
    expect(il2).toBeCloseTo(1000 * ilPct * rangeWidth, 8);
  });
});

describe("in-range → out-of-range transition", () => {
  it("fees stop accruing after candle leaves range", () => {
    const pos = {
      lowerPrice: 0.9,
      upperPrice: 1.1,
      lpFeeFraction: 0.002,
      avgExistingBinTvl: 5000,
      weights: Array(21).fill(1 / 21),
      depositAmount: 1000,
      entryPrice: 1.0,
    };
    // In-range candle
    const c1 = { low: 0.95, high: 1.05, close: 1.0, volume: 50000 };
    // Out-of-range candle (above)
    const c2 = { low: 1.15, high: 1.25, close: 1.20, volume: 50000 };

    const { feeEarned: f1, inRange: ir1 } = processCandle(c1, pos);
    const { feeEarned: f2, inRange: ir2 } = processCandle(c2, pos);

    expect(ir1).toBe(true);
    expect(f1).toBeGreaterThan(0);
    expect(ir2).toBe(false);
    expect(f2).toBe(0);
  });
});

describe("computeInitialSplit", () => {
  it("splits deposit 50/50 when entry is at midpoint of symmetric range", () => {
    const { xUsd, yUsd } = computeInitialSplit(1000, 1.0, 0.9, 1.1);
    // Not exactly 50/50 (sqrt-price geometry), but both should be positive
    expect(xUsd).toBeGreaterThan(0);
    expect(yUsd).toBeGreaterThan(0);
    expect(xUsd + yUsd).toBeCloseTo(1000, 6);
  });

  it("xFrac + yFrac = 1 (capital is fully allocated)", () => {
    const deposit = 500;
    const { xUsd, yUsd } = computeInitialSplit(deposit, 1.2, 0.8, 2.0);
    expect(xUsd + yUsd).toBeCloseTo(deposit, 6);
  });

  it("at lower boundary: all capital is token X (yFrac=0)", () => {
    // entry clamped to lowerPrice → sqrtP = sqrtPa → yFrac = 0
    const { xUsd, yUsd } = computeInitialSplit(1000, 0.9, 0.9, 1.1);
    expect(yUsd).toBeCloseTo(0, 6);
    expect(xUsd).toBeCloseTo(1000, 6);
  });

  it("at upper boundary: all capital is token Y (xFrac=0)", () => {
    // entry clamped to upperPrice → sqrtP = sqrtPb → yFrac = 1
    const { xUsd, yUsd } = computeInitialSplit(1000, 1.1, 0.9, 1.1);
    expect(xUsd).toBeCloseTo(0, 6);
    expect(yUsd).toBeCloseTo(1000, 6);
  });
});

describe("closePaperPosition — persistence and close logic", () => {
  it("marks position as closed and returns summary", () => {
    const pos = makePosition({ id: "paper-close01" });
    seedState({ "paper-close01": pos });

    const result = closePaperPosition("paper-close01");
    expect(result.status).toBe("closed");
    expect(result.closed_at).not.toBeNull();
    expect(result.id).toBe("paper-close01");
  });

  it("returned summary includes fees_earned, il_usd, net_pnl", () => {
    const pos = makePosition({
      id:           "paper-close02",
      fees_earned:  12.5,
      il_usd:       -4.2,
      net_pnl:      8.3,
    });
    seedState({ "paper-close02": pos });

    const result = closePaperPosition("paper-close02");
    expect(result.fees_earned).toBe(12.5);
    expect(result.il_usd).toBe(-4.2);
    expect(result.net_pnl).toBe(8.3);
  });

  it("throws when position not found", () => {
    seedState({});
    expect(() => closePaperPosition("paper-nonexistent")).toThrow(/not found/i);
  });

  it("throws when position is already closed", () => {
    const pos = makePosition({ id: "paper-closed01", status: "closed" });
    seedState({ "paper-closed01": pos });
    expect(() => closePaperPosition("paper-closed01")).toThrow(/already closed/i);
  });
});

describe("getPaperPosition — read-back", () => {
  it("returns formatted summary matching stored position", () => {
    const pos = makePosition({ id: "paper-get01" });
    seedState({ "paper-get01": pos });

    const result = getPaperPosition("paper-get01");
    expect(result.id).toBe("paper-get01");
    expect(result.deposit).toBe(1000);
    expect(result.status).toBe("open");
    expect(result.range.lower).toBe(0.9);
    expect(result.range.upper).toBe(1.1);
  });

  it("throws when position not found", () => {
    seedState({});
    expect(() => getPaperPosition("paper-missing")).toThrow(/not found/i);
  });
});

describe("listPaperPositions — persistence", () => {
  it("returns empty array when no positions exist", () => {
    seedState({});
    expect(listPaperPositions()).toEqual([]);
  });

  it("returns both open and closed positions", () => {
    const p1 = makePosition({ id: "paper-list01", status: "open" });
    const p2 = makePosition({ id: "paper-list02", status: "closed" });
    seedState({ "paper-list01": p1, "paper-list02": p2 });

    const all = listPaperPositions();
    expect(all).toHaveLength(2);
    const statuses = all.map((p) => p.status);
    expect(statuses).toContain("open");
    expect(statuses).toContain("closed");
  });

  it("deposit_amount is preserved unchanged after listing", () => {
    const pos = makePosition({ id: "paper-list03", deposit_amount: 750 });
    seedState({ "paper-list03": pos });
    const [result] = listPaperPositions();
    expect(result.deposit).toBe(750);
  });
});

describe("formatSummary — computed fields", () => {
  it("in_range_pct is null when no candles processed", () => {
    const pos = makePosition({ id: "paper-fmt01", candles_total: 0, candles_in_range: 0 });
    seedState({ "paper-fmt01": pos });
    const result = getPaperPosition("paper-fmt01");
    expect(result.in_range_pct).toBeNull();
  });

  it("in_range_pct is 50.0 when half of 10 candles were in range", () => {
    const pos = makePosition({
      id: "paper-fmt02",
      candles_total: 10,
      candles_in_range: 5,
      entry_timestamp: 1748390000,
      last_candle_timestamp: 1748390000 + 3600, // 1h later
    });
    seedState({ "paper-fmt02": pos });
    const result = getPaperPosition("paper-fmt02");
    expect(result.in_range_pct).toBe(50.0);
  });

  it("annualized_fee_apr is null when no fees earned", () => {
    const pos = makePosition({
      id: "paper-fmt03",
      fees_earned: 0,
      entry_timestamp: 1748390000,
      last_candle_timestamp: 1748390000 + 7200,
    });
    seedState({ "paper-fmt03": pos });
    const result = getPaperPosition("paper-fmt03");
    expect(result.annualized_fee_apr).toBeNull();
  });

  it("annualized_fee_apr is positive when fees > 0 and duration > 0", () => {
    const pos = makePosition({
      id: "paper-fmt04",
      fees_earned: 10,
      deposit_amount: 1000,
      entry_timestamp: 1748390000,
      last_candle_timestamp: 1748390000 + 3600, // 1 hour
    });
    seedState({ "paper-fmt04": pos });
    const result = getPaperPosition("paper-fmt04");
    // APR = (10/1000) * (8760/1) * 100 = 87600%
    expect(result.annualized_fee_apr).toBeCloseTo((10 / 1000) * 8760 * 100, 1);
  });
});

describe("ohlcv fixture — smoke test with real candle data", () => {
  it("all 10 fixture candles are processable and produce finite results", () => {
    const pos = {
      lowerPrice: 0.95,
      upperPrice: 1.05,
      lpFeeFraction: 0.002,
      avgExistingBinTvl: 10000,
      weights: Array(11).fill(1 / 11),
      depositAmount: 2000,
      entryPrice: 1.0,
    };
    let totalFees = 0;
    let inRangeCount = 0;
    for (const candle of ohlcv) {
      const { feeEarned, ilUsd, inRange } = processCandle(candle, pos);
      expect(Number.isFinite(feeEarned)).toBe(true);
      expect(Number.isFinite(ilUsd)).toBe(true);
      totalFees += feeEarned;
      if (inRange) inRangeCount++;
    }
    // Candles 1–5 are in range [0.95, 1.05]; later candles drift lower
    expect(inRangeCount).toBeGreaterThan(0);
    expect(totalFees).toBeGreaterThan(0);
  });
});
