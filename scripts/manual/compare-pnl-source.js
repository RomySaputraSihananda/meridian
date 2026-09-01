/**
 * Read-only comparison: fetches your open positions via BOTH the existing
 * relay/LPAgent path and the new RPC path, side by side. Does not change
 * config.pnl.source — safe to run against a live wallet with open positions.
 * Run: node scripts/manual/compare-pnl-source.js
 */

import "dotenv/config";
import { getMyPositions } from "../../tools/dlmm.js";
import { computePositions } from "../../tools/pnl-rpc.js";
import { getWallet } from "../../tools/dlmm-adapter.js";

function summarize(positions) {
  return Object.fromEntries(
    positions.map(p => [p.position.slice(0, 8), {
      pnl_pct: p.pnl_pct,
      pnl_usd: p.pnl_usd,
      in_range: p.in_range,
      suspicious: p.pnl_pct_suspicious,
    }])
  );
}

async function main() {
  const walletAddress = getWallet().publicKey.toString();
  console.log(`Wallet: ${walletAddress}\n`);

  const [relay, rpc] = await Promise.all([
    getMyPositions({ force: true, silent: true }),
    computePositions(walletAddress).catch(err => ({ error: err.message, positions: [] })),
  ]);

  if (relay.total_positions === 0 && (rpc.positions || []).length === 0) {
    console.log("No open positions right now — nothing to compare. Try again once a position is live.");
    return;
  }

  console.log("=== relay/LPAgent path (current default) ===");
  console.table(summarize(relay.positions || []));

  console.log("\n=== rpc path (new, opt-in) ===");
  if (rpc.error) console.log(`Error: ${rpc.error}`);
  console.table(summarize(rpc.positions || []));
}

main().catch(console.error);
