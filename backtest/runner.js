/**
 * Historical OHLCV backtest runner.
 * Replays candles through the paper-positions.js engine (processCandle).
 * Input: JSONL file where each line is { timestamp, open, high, low, close, volume }
 * Output: { metrics, trades[] }
 *
 * Usage:
 *   node backtest/runner.js --data backtest/data/sample.jsonl \
 *     --strategy spot --bins-below 52 --bins-above 52 \
 *     --bin-step 100 --capital-sol 1.0 --lp-fee-pct 0.3
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { computeMetrics } from "./metrics.js";
import { processCandle } from "../paper-positions.js";

// ─── CLI argument parser ───────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get  = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : def;
  };
  return {
    dataFile:     get("--data",            null),
    strategy:     get("--strategy",        "spot"),
    binsBelow:    Number(get("--bins-below",    52)),
    binsAbove:    Number(get("--bins-above",    52)),
    binStep:      Number(get("--bin-step",      100)),
    capitalSol:   Number(get("--capital-sol",   1.0)),
    lpFeePct:     Number(get("--lp-fee-pct",    0.3)),
    exitAfterOOR: Number(get("--exit-after-oor", 5)),
  };
}

// ─── JSONL loader ──────────────────────────────────────────────────────────────

function loadCandles(dataFile) {
  const lines = fs.readFileSync(dataFile, "utf8").trim().split("\n");
  return lines.filter((l) => l.trim()).map((line) => JSON.parse(line));
}

// ─── Position builder ──────────────────────────────────────────────────────────

/**
 * Build an in-memory position object compatible with processCandle().
 * processCandle expects camelCase fields (lowerPrice, upperPrice, etc.).
 */
function buildPosition(candles, opts) {
  if (!candles.length) throw new Error("No candles provided");
  const entry = candles[0];
  const entryPrice = (entry.open + entry.close) / 2;

  // Compute bin prices from binStep (binStep is in basis points: 100 = 1%)
  const binStepFrac = opts.binStep / 10000;
  const lowerPrice  = entryPrice * Math.pow(1 - binStepFrac, opts.binsBelow);
  const upperPrice  = entryPrice * Math.pow(1 + binStepFrac, opts.binsAbove);

  const numBins          = opts.binsBelow + opts.binsAbove;
  const depositUsd       = opts.capitalSol * 100; // approximate: $100/SOL
  const avgExistingBinTvl = depositUsd; // assume our deposit sets the market (conservative)
  const weights          = Array(numBins).fill(1 / numBins);

  return {
    // processCandle camelCase fields
    lowerPrice,
    upperPrice,
    entryPrice,
    lpFeeFraction:      opts.lpFeePct / 100,
    avgExistingBinTvl,
    weights,
    depositAmount:      depositUsd,
    initialXUsd:        depositUsd / 2,
    initialYUsd:        depositUsd / 2,
    lowerBinId:         -opts.binsBelow,
    upperBinId:         opts.binsAbove,

    // accounting fields (updated by runBacktest)
    fees_earned:        0,
    il_usd:             0,
    net_pnl:            0,
    candles_total:      0,
    candles_in_range:   0,

    // metadata
    capital_sol:        opts.capitalSol,
    deposit_amount_usd: depositUsd,
    strategy:           opts.strategy,
  };
}

// ─── Core backtest engine ──────────────────────────────────────────────────────

/**
 * Run one backtest pass over a candle array.
 * Returns { metrics, trades }.
 *
 * opts:
 *   binsBelow     {number}  bins below entry (default 52)
 *   binsAbove     {number}  bins above entry (default 52)
 *   binStep       {number}  bin step in bps, e.g. 100 = 1% (default 100)
 *   capitalSol    {number}  SOL deployed (default 1.0)
 *   lpFeePct      {number}  LP fee percent, e.g. 0.3 = 0.3% (default 0.3)
 *   exitAfterOOR  {number}  exit after N consecutive OOR candles (default 5)
 *   strategy      {string}  "spot" | "curve" | "bid_ask" (cosmetic only)
 */
export function runBacktest(candles, opts = {}) {
  const fullOpts = {
    binsBelow:    opts.binsBelow    ?? 52,
    binsAbove:    opts.binsAbove    ?? 52,
    binStep:      opts.binStep      ?? 100,
    capitalSol:   opts.capitalSol   ?? 1.0,
    lpFeePct:     opts.lpFeePct     ?? 0.3,
    exitAfterOOR: opts.exitAfterOOR ?? 5,
    strategy:     opts.strategy     ?? "spot",
  };

  if (!candles.length) return { metrics: computeMetrics([]), trades: [] };

  const position = buildPosition(candles, fullOpts);
  let oorStreak  = 0;

  for (const candle of candles) {
    const { feeEarned, ilUsd, inRange } = processCandle(candle, position);

    position.fees_earned    += feeEarned;
    position.il_usd          = ilUsd;   // IL is absolute, not cumulative
    position.net_pnl         = position.fees_earned + position.il_usd;
    position.candles_total  += 1;

    if (inRange) {
      position.candles_in_range += 1;
      oorStreak = 0;
    } else {
      oorStreak += 1;
      if (oorStreak >= fullOpts.exitAfterOOR) break;
    }
  }

  const depositUsd = position.deposit_amount_usd;
  const netPnlPct  = depositUsd > 0 ? (position.net_pnl / depositUsd) * 100 : 0;
  // Approximate fees in SOL: fee USD back-converted using same $100/SOL assumption
  const feesSol    = position.fees_earned / 100;

  const trade = {
    net_pnl_pct:       parseFloat(netPnlPct.toFixed(4)),
    fees_sol:          parseFloat(feesSol.toFixed(6)),
    il_usd:            parseFloat(position.il_usd.toFixed(4)),
    candles_total:     position.candles_total,
    candles_in_range:  position.candles_in_range,
  };

  return { metrics: computeMetrics([trade]), trades: [trade] };
}

// ─── CLI entry point ───────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const opts = parseArgs();
  if (!opts.dataFile) {
    console.error("Usage: node backtest/runner.js --data <file.jsonl> [options]");
    console.error("");
    console.error("Options:");
    console.error("  --strategy        spot|curve|bid_ask  (default: spot)");
    console.error("  --bins-below      N                   (default: 52)");
    console.error("  --bins-above      N                   (default: 52)");
    console.error("  --bin-step        bps                 (default: 100)");
    console.error("  --capital-sol     SOL                 (default: 1.0)");
    console.error("  --lp-fee-pct      %                   (default: 0.3)");
    console.error("  --exit-after-oor  N candles           (default: 5)");
    process.exit(1);
  }

  const candles = loadCandles(opts.dataFile);
  console.log(`Loaded ${candles.length} candles from ${opts.dataFile}`);

  const { metrics, trades } = runBacktest(candles, opts);

  console.log("\n=== Backtest Results ===");
  console.log(JSON.stringify(metrics, null, 2));
  console.log(`\nTrades: ${trades.length}`);
  if (trades.length) {
    console.log("\nTrade detail:");
    console.log(JSON.stringify(trades[0], null, 2));
  }
}
