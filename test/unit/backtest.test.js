/**
 * test/unit/backtest.test.js
 *
 * Unit tests for backtest/metrics.js and backtest/runner.js.
 * The runner imports processCandle from paper-positions.js — no mocking needed
 * since processCandle is pure math with no I/O or network calls.
 */

import { describe, it, expect, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// ── Suppress logger for any transitive import that touches logger.js ──────────
vi.mock("../../logger.js", () => ({ log: vi.fn() }));

// ── Imports ───────────────────────────────────────────────────────────────────
import { computeMetrics } from "../../backtest/metrics.js";
import { runBacktest } from "../../backtest/runner.js";

const ohlcv = require("../fixtures/ohlcv.json");

// ─────────────────────────────────────────────────────────────────────────────
// computeMetrics
// ─────────────────────────────────────────────────────────────────────────────

describe("computeMetrics", () => {
  it("returns { trades: 0 } for empty input", () => {
    const m = computeMetrics([]);
    expect(m.trades).toBe(0);
    expect(Object.keys(m)).toEqual(["trades"]);
  });

  it("computes win_rate correctly", () => {
    const trades = [
      { net_pnl_pct: 5 },
      { net_pnl_pct: -3 },
      { net_pnl_pct: 2 },
    ];
    const m = computeMetrics(trades);
    expect(m.win_rate).toBeCloseTo(2 / 3, 2);
  });

  it("all-win produces win_rate=1 and avg_loss_pct=0", () => {
    const trades = [{ net_pnl_pct: 3 }, { net_pnl_pct: 7 }];
    const m = computeMetrics(trades);
    expect(m.win_rate).toBe(1);
    expect(m.avg_loss_pct).toBe(0);
  });

  it("all-loss produces win_rate=0 and avg_win_pct=0", () => {
    const trades = [{ net_pnl_pct: -3 }, { net_pnl_pct: -7 }];
    const m = computeMetrics(trades);
    expect(m.win_rate).toBe(0);
    expect(m.avg_win_pct).toBe(0);
  });

  it("computes expectancy correctly (50/50 win/loss)", () => {
    const trades = [
      { net_pnl_pct: 10, fees_sol: 0.01 },
      { net_pnl_pct: -5, fees_sol: 0.01 },
    ];
    const m = computeMetrics(trades);
    // winRate=0.5, avgWin=10, avgLoss=-5 → expectancy = 0.5*10 + 0.5*(-5) = 2.5
    expect(m.expectancy_pct).toBeCloseTo(2.5, 1);
  });

  it("computes max_drawdown correctly", () => {
    // cumPnL sequence: 5, 10, 5, 3 → peak=10, trough=3, drawdown=7
    const trades = [
      { net_pnl_pct: 5 },
      { net_pnl_pct: 5 },
      { net_pnl_pct: -5 },
      { net_pnl_pct: -2 },
    ];
    const m = computeMetrics(trades);
    expect(m.max_drawdown_pct).toBeCloseTo(7, 1);
  });

  it("max_drawdown is 0 when PnL is monotonically increasing", () => {
    const trades = [{ net_pnl_pct: 1 }, { net_pnl_pct: 2 }, { net_pnl_pct: 3 }];
    expect(computeMetrics(trades).max_drawdown_pct).toBe(0);
  });

  it("accumulates total_fees_sol correctly", () => {
    const trades = [
      { net_pnl_pct: 1, fees_sol: 0.1 },
      { net_pnl_pct: 2, fees_sol: 0.2 },
    ];
    expect(computeMetrics(trades).total_fees_sol).toBeCloseTo(0.3, 6);
  });

  it("total_fees_sol is 0 when fees_sol is absent from all trades", () => {
    const trades = [{ net_pnl_pct: 1 }, { net_pnl_pct: -1 }];
    expect(computeMetrics(trades).total_fees_sol).toBe(0);
  });

  it("total_net_pnl_pct is sum of all net_pnl_pct values", () => {
    const trades = [
      { net_pnl_pct: 3 },
      { net_pnl_pct: -1 },
      { net_pnl_pct: 2 },
    ];
    expect(computeMetrics(trades).total_net_pnl_pct).toBeCloseTo(4, 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runBacktest
// ─────────────────────────────────────────────────────────────────────────────

describe("runBacktest", () => {
  const defaultOpts = {
    binsBelow:  52,
    binsAbove:  52,
    binStep:    100,
    capitalSol: 1,
    lpFeePct:   0.3,
  };

  it("returns { metrics: { trades: 0 }, trades: [] } for empty candle array", () => {
    const { metrics, trades } = runBacktest([], defaultOpts);
    expect(metrics.trades).toBe(0);
    expect(trades).toHaveLength(0);
  });

  it("returns a single trade when given the OHLCV fixture", () => {
    const { trades } = runBacktest(ohlcv, defaultOpts);
    expect(trades).toHaveLength(1);
  });

  it("metrics.trades equals trades.length", () => {
    const { metrics, trades } = runBacktest(ohlcv, defaultOpts);
    expect(metrics.trades).toBe(trades.length);
  });

  it("win_rate is in [0, 1]", () => {
    const { metrics } = runBacktest(ohlcv, defaultOpts);
    expect(metrics.win_rate).toBeGreaterThanOrEqual(0);
    expect(metrics.win_rate).toBeLessThanOrEqual(1);
  });

  it("max_drawdown_pct is non-negative", () => {
    const { metrics } = runBacktest(ohlcv, defaultOpts);
    expect(metrics.max_drawdown_pct).toBeGreaterThanOrEqual(0);
  });

  it("expectancy_pct and total_net_pnl_pct are finite numbers", () => {
    const { metrics } = runBacktest(ohlcv, defaultOpts);
    expect(typeof metrics.expectancy_pct).toBe("number");
    expect(Number.isFinite(metrics.expectancy_pct)).toBe(true);
    expect(Number.isFinite(metrics.total_net_pnl_pct)).toBe(true);
  });

  it("trade has expected shape", () => {
    const { trades } = runBacktest(ohlcv, defaultOpts);
    const t = trades[0];
    expect(typeof t.net_pnl_pct).toBe("number");
    expect(typeof t.fees_sol).toBe("number");
    expect(typeof t.il_usd).toBe("number");
    expect(typeof t.candles_total).toBe("number");
    expect(typeof t.candles_in_range).toBe("number");
  });

  it("candles_in_range <= candles_total", () => {
    const { trades } = runBacktest(ohlcv, defaultOpts);
    expect(trades[0].candles_in_range).toBeLessThanOrEqual(trades[0].candles_total);
  });

  it("fees_sol >= 0 (fees are non-negative)", () => {
    const { trades } = runBacktest(ohlcv, defaultOpts);
    expect(trades[0].fees_sol).toBeGreaterThanOrEqual(0);
  });

  it("in-range run produces positive fees", () => {
    // ohlcv fixture prices cluster around 1.0; wide bins-below/above keeps us in range
    const { trades } = runBacktest(ohlcv, { ...defaultOpts, binsBelow: 100, binsAbove: 100 });
    expect(trades[0].fees_sol).toBeGreaterThan(0);
  });

  it("exitAfterOOR=1 stops after first OOR candle", () => {
    // Use candles that go OOR immediately (price 10x higher than entry)
    const oorCandles = ohlcv.map((c, i) =>
      i === 0
        ? c                  // first candle sets entry price
        : { ...c, open: c.open * 10, close: c.close * 10, high: c.high * 10, low: c.low * 10 }
    );
    const { trades } = runBacktest(oorCandles, { ...defaultOpts, binsBelow: 2, binsAbove: 2, exitAfterOOR: 1 });
    // Should process at most 2 candles (entry + 1 OOR that triggers exit)
    expect(trades[0].candles_total).toBeLessThanOrEqual(2);
  });
});
