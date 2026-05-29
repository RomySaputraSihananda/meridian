#!/usr/bin/env node
/**
 * Net-honest comparison harness.
 *
 * Compares two sets of closed position records and reports side-by-side:
 *   - Net PnL (fees + position value − capital − slippage/dust)
 *   - Win rate, expectancy, max drawdown
 *   - Slippage/reconciliation gap (if realized_sol is available)
 *
 * Usage:
 *   node scripts/compare-branches.js --a lessons-main.json --b lessons-integration.json
 *   node scripts/compare-branches.js --a lessons.json --b profiles/autoresearch/lessons.json
 *
 * Does NOT claim one set is "better" — produces numbers only.
 */

import fs from "fs";
import path from "path";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };
  return {
    fileA: get("--a", null),
    fileB: get("--b", null),
    label: get("--label", "A vs B"),
    hours: Number(get("--hours", 0)), // 0 = all time
  };
}

function loadPerformance(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Array.isArray(data) ? data : (data.performance ?? []);
}

function computeStats(records, { hours = 0 } = {}) {
  let data = records;
  if (hours > 0) {
    const cutoff = Date.now() - hours * 3600_000;
    data = records.filter((p) => {
      const ts = p.recorded_at ?? p.closed_at;
      return ts && new Date(ts).getTime() >= cutoff;
    });
  }

  if (!data.length) return { count: 0, net_pnl_usd: 0, win_rate: 0, expectancy_usd: 0, max_drawdown_usd: 0, reconciliation_gap_sol: "n/a (no realized_sol data)" };

  const wins = data.filter((p) => (p.pnl_usd ?? 0) > 0);
  const losses = data.filter((p) => (p.pnl_usd ?? 0) <= 0);
  const winRate = wins.length / data.length;
  const avgWin = wins.length ? wins.reduce((s, p) => s + (p.pnl_usd ?? 0), 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, p) => s + (p.pnl_usd ?? 0), 0) / losses.length : 0;
  const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;

  let peak = 0, cumPnl = 0, maxDrawdown = 0;
  for (const p of data) {
    cumPnl += (p.pnl_usd ?? 0);
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Reconciliation gap (F3): realized vs reported
  const reconcilable = data.filter((p) => p.realized_sol != null && p.pnl_sol != null);
  const reconciliationGap = reconcilable.length > 0
    ? reconcilable.reduce((s, p) => s + (p.realized_sol - (p.pnl_sol ?? 0)), 0)
    : null;

  return {
    count: data.length,
    net_pnl_usd: parseFloat(data.reduce((s, p) => s + (p.pnl_usd ?? 0), 0).toFixed(2)),
    win_rate: parseFloat(winRate.toFixed(4)),
    avg_win_usd: parseFloat(avgWin.toFixed(2)),
    avg_loss_usd: parseFloat(avgLoss.toFixed(2)),
    expectancy_usd: parseFloat(expectancy.toFixed(2)),
    max_drawdown_usd: parseFloat(maxDrawdown.toFixed(2)),
    reconciliation_gap_sol: reconciliationGap != null ? parseFloat(reconciliationGap.toFixed(6)) : "n/a (no realized_sol data)",
  };
}

function formatTable(labelA, statsA, labelB, statsB) {
  const keys = Object.keys(statsA);
  const col = 28;
  const lines = [
    "",
    "=".repeat(70),
    " NET-HONEST COMPARISON HARNESS",
    "=".repeat(70),
    ` ${"Metric".padEnd(col)} ${String(labelA).padEnd(20)} ${String(labelB)}`,
    "-".repeat(70),
  ];
  for (const key of keys) {
    const a = String(statsA[key]);
    const b = String(statsB[key]);
    const flag = (typeof statsA[key] === "number" && typeof statsB[key] === "number")
      ? (statsA[key] > statsB[key] ? "  <- A higher" : statsA[key] < statsB[key] ? "  <- B higher" : "  equal")
      : "";
    lines.push(` ${key.replace(/_/g, " ").padEnd(col)} ${a.padEnd(20)} ${b}${flag}`);
  }
  lines.push("-".repeat(70));
  lines.push(" NOTE: Higher net_pnl/win_rate/expectancy is better.");
  lines.push("       Lower max_drawdown and reconciliation_gap is better.");
  lines.push(" This harness reports numbers only — no profitability claim.");
  lines.push("=".repeat(70));
  lines.push("");
  return lines.join("\n");
}

const opts = parseArgs();
if (!opts.fileA || !opts.fileB) {
  console.log("Usage: node scripts/compare-branches.js --a <lessons-a.json> --b <lessons-b.json> [--hours 24]");
  process.exit(0);
}

const perfA = loadPerformance(opts.fileA);
const perfB = loadPerformance(opts.fileB);
const labelA = path.basename(opts.fileA, ".json");
const labelB = path.basename(opts.fileB, ".json");

const statsA = computeStats(perfA, { hours: opts.hours });
const statsB = computeStats(perfB, { hours: opts.hours });

console.log(formatTable(labelA, statsA, labelB, statsB));
