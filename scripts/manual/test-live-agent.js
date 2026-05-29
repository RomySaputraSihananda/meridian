/**
 * LIVE FUND SCRIPT — deploys a real position.
 * NOT run by `npm test`. Run manually: DRY_RUN=true node scripts/manual/test-live-agent.js
 * Requires a funded wallet and valid RPC/API keys in .env or user-config.json.
 */

/**
 * Test the full agent loop in dry-run mode (no wallet needed for screening).
 * Run: DRY_RUN=true node scripts/manual/test-live-agent.js
 */

import "dotenv/config";
import { agentLoop } from "../../agent.js";

async function main() {
  console.log("=== Testing Agent Loop (DRY RUN) ===\n");
  console.log("Goal: Discover top pools and recommend 3 LP opportunities\n");

  const result = await agentLoop(
    "Run get_top_candidates. Then deploy_position into the #1 candidate using 0.1 SOL. Report what was deployed.",
    5
  );

  console.log("\n=== Agent Response ===");
  console.log(result);
  console.log("\n=== Test complete ===");
}

main().catch(console.error);
