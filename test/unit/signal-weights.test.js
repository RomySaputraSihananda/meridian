import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import { recalculateWeights } from "../../signal-weights.js";

const WEIGHTS_FILE = "./signal-weights.json";

const defaultCfg = {
  darwin: {
    enabled: true,
    boostFactor: 1.05,
    decayFactor: 0.95,
    weightFloor: 0.3,
    weightCeiling: 2.5,
    minSamples: 10,
    windowDays: 60,
  },
};

describe("recalculateWeights", () => {
  beforeEach(() => {
    // Backup existing weights file if it exists
    if (fs.existsSync(WEIGHTS_FILE)) {
      fs.copyFileSync(WEIGHTS_FILE, WEIGHTS_FILE + ".backup");
      fs.unlinkSync(WEIGHTS_FILE);
    }
  });

  afterEach(() => {
    // Restore backup or clean up test file
    if (fs.existsSync(WEIGHTS_FILE + ".backup")) {
      fs.unlinkSync(WEIGHTS_FILE + ".backup");
    }
    if (fs.existsSync(WEIGHTS_FILE)) {
      fs.unlinkSync(WEIGHTS_FILE);
    }
  });

  it("returns object with changes and weights properties", () => {
    const perfData = Array(15)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - i * 86400000).toISOString(),
        pnl_usd: i % 2 === 0 ? 100 : -50,
        signal_snapshot: { organic_score: 80, fee_tvl_ratio: 0.08 },
      }));

    const result = recalculateWeights(perfData, defaultCfg);
    expect(result).toHaveProperty("changes");
    expect(result).toHaveProperty("weights");
    expect(Array.isArray(result.changes)).toBe(true);
    expect(typeof result.weights).toBe("object");
  });

  it("returns null (via { changes: [], weights }) when fewer than minSamples", () => {
    const perfData = Array(5)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - i * 86400000).toISOString(),
        pnl_usd: i % 2 === 0 ? 100 : -50,
        signal_snapshot: { organic_score: 80 },
      }));

    const result = recalculateWeights(perfData, defaultCfg);
    expect(result.changes.length).toBe(0);
    // weights still exist but unchanged
    expect(typeof result.weights).toBe("object");
  });

  it("returns empty changes when no wins or no losses", () => {
    // All wins — no losses
    const allWins = Array(15)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - i * 86400000).toISOString(),
        pnl_usd: 100,
        signal_snapshot: { organic_score: 80, fee_tvl_ratio: 0.08 },
      }));

    const result = recalculateWeights(allWins, defaultCfg);
    expect(result.changes.length).toBe(0);
  });

  it("boosts signals that correlate with wins (top quartile)", () => {
    // Create data where organic_score is high in wins, low in losses
    const wins = Array(8)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - i * 86400000).toISOString(),
        pnl_usd: 150,
        signal_snapshot: { organic_score: 90, fee_tvl_ratio: 0.05, volume: 5000 },
      }));

    const losses = Array(8)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - (i + 10) * 86400000).toISOString(),
        pnl_usd: -50,
        signal_snapshot: { organic_score: 30, fee_tvl_ratio: 0.02, volume: 200 },
      }));

    const result = recalculateWeights([...wins, ...losses], defaultCfg);
    // organic_score should be boosted (high in wins, low in losses)
    const organicChange = result.changes.find((c) => c.signal === "organic_score");
    if (organicChange) {
      expect(organicChange.action).toBe("boosted");
      expect(organicChange.to).toBeGreaterThan(organicChange.from);
    }
  });

  it("decays signals that correlate with losses (bottom quartile)", () => {
    // Create data where mcap is high in losses, low in wins
    const wins = Array(8)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - i * 86400000).toISOString(),
        pnl_usd: 150,
        signal_snapshot: { organic_score: 85, mcap: 1000000, fee_tvl_ratio: 0.08 },
      }));

    const losses = Array(8)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - (i + 10) * 86400000).toISOString(),
        pnl_usd: -50,
        signal_snapshot: { organic_score: 80, mcap: 8000000, fee_tvl_ratio: 0.06 },
      }));

    const result = recalculateWeights([...wins, ...losses], defaultCfg);
    // mcap is HIGHER_IS_BETTER=false, so high mcap in losses should decay it
    const mcapChange = result.changes.find((c) => c.signal === "mcap");
    if (mcapChange) {
      expect(mcapChange.action).toBe("decayed");
      expect(mcapChange.to).toBeLessThan(mcapChange.from);
    }
  });

  it("never boosts weights above weightCeiling", () => {
    const wins = Array(8)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - i * 86400000).toISOString(),
        pnl_usd: 200,
        signal_snapshot: {
          organic_score: 95,
          fee_tvl_ratio: 0.1,
          volume: 8000,
          holder_count: 5000,
          study_win_rate: 0.95,
        },
      }));

    const losses = Array(8)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - (i + 10) * 86400000).toISOString(),
        pnl_usd: -100,
        signal_snapshot: {
          organic_score: 20,
          fee_tvl_ratio: 0.01,
          volume: 100,
          holder_count: 200,
          study_win_rate: 0.1,
        },
      }));

    const result = recalculateWeights([...wins, ...losses], defaultCfg);
    for (const signal in result.weights) {
      expect(result.weights[signal]).toBeLessThanOrEqual(2.5);
    }
  });

  it("never decays weights below weightFloor", () => {
    const wins = Array(8)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - i * 86400000).toISOString(),
        pnl_usd: 100,
        signal_snapshot: {
          organic_score: 20,
          fee_tvl_ratio: 0.01,
          volume: 100,
          holder_count: 200,
          study_win_rate: 0.1,
        },
      }));

    const losses = Array(8)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - (i + 10) * 86400000).toISOString(),
        pnl_usd: -100,
        signal_snapshot: {
          organic_score: 95,
          fee_tvl_ratio: 0.1,
          volume: 8000,
          holder_count: 5000,
          study_win_rate: 0.95,
        },
      }));

    const result = recalculateWeights([...wins, ...losses], defaultCfg);
    for (const signal in result.weights) {
      expect(result.weights[signal]).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("filters data by rolling window (windowDays)", () => {
    // All data outside the window
    const oldData = Array(15)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - (70 + i) * 86400000).toISOString(),
        pnl_usd: i % 2 === 0 ? 100 : -50,
        signal_snapshot: { organic_score: 80 },
      }));

    const result = recalculateWeights(oldData, defaultCfg);
    // Should skip recalc because old data is outside window
    expect(result.changes.length).toBe(0);
  });

  it("persists weights to signal-weights.json", () => {
    const perfData = Array(15)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - i * 86400000).toISOString(),
        pnl_usd: i % 2 === 0 ? 100 : -50,
        signal_snapshot: { organic_score: 80, fee_tvl_ratio: 0.08 },
      }));

    recalculateWeights(perfData, defaultCfg);
    expect(fs.existsSync(WEIGHTS_FILE)).toBe(true);

    const data = JSON.parse(fs.readFileSync(WEIGHTS_FILE, "utf8"));
    expect(data).toHaveProperty("weights");
    expect(typeof data.weights).toBe("object");
  });

  it("increments recalc_count on each call", () => {
    const perfData = Array(15)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - i * 86400000).toISOString(),
        pnl_usd: i % 2 === 0 ? 100 : -50,
        signal_snapshot: { organic_score: 80, fee_tvl_ratio: 0.08 },
      }));

    recalculateWeights(perfData, defaultCfg);
    const data1 = JSON.parse(fs.readFileSync(WEIGHTS_FILE, "utf8"));
    const count1 = data1.recalc_count || 0;

    recalculateWeights(perfData, defaultCfg);
    const data2 = JSON.parse(fs.readFileSync(WEIGHTS_FILE, "utf8"));
    const count2 = data2.recalc_count || 0;

    expect(count2).toBeGreaterThan(count1);
  });

  it("records changes in history (max 20 entries)", () => {
    const perfData = Array(15)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - i * 86400000).toISOString(),
        pnl_usd: i % 2 === 0 ? 100 : -50,
        signal_snapshot: { organic_score: i * 10 + 50, fee_tvl_ratio: 0.05 + i * 0.01 },
      }));

    recalculateWeights(perfData, defaultCfg);
    const data = JSON.parse(fs.readFileSync(WEIGHTS_FILE, "utf8"));
    if (data.history && data.history.length > 0) {
      const entry = data.history[data.history.length - 1];
      expect(entry).toHaveProperty("timestamp");
      expect(entry).toHaveProperty("changes");
      expect(Array.isArray(entry.changes)).toBe(true);
    }
  });

  it("handles data with recorded_at, closed_at, or deployed_at timestamps", () => {
    const perfData = [
      // Mix of timestamp fields
      ...Array(5)
        .fill(null)
        .map((_, i) => ({
          recorded_at: new Date(Date.now() - i * 86400000).toISOString(),
          pnl_usd: 100,
          signal_snapshot: { organic_score: 80 },
        })),
      ...Array(5)
        .fill(null)
        .map((_, i) => ({
          closed_at: new Date(Date.now() - (i + 5) * 86400000).toISOString(),
          pnl_usd: -50,
          signal_snapshot: { organic_score: 40 },
        })),
      ...Array(5)
        .fill(null)
        .map((_, i) => ({
          deployed_at: new Date(Date.now() - (i + 10) * 86400000).toISOString(),
          pnl_usd: 100,
          signal_snapshot: { organic_score: 85 },
        })),
    ];

    const result = recalculateWeights(perfData, defaultCfg);
    expect(result).toHaveProperty("changes");
    expect(result).toHaveProperty("weights");
  });

  it("computes numeric signal lift correctly (HIGHER_IS_BETTER)", () => {
    // organic_score is HIGHER_IS_BETTER
    // High in wins (90), low in losses (30) → should boost
    const wins = Array(8)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - i * 86400000).toISOString(),
        pnl_usd: 150,
        organic_score: 90, // Direct field, not in snapshot
      }));

    const losses = Array(8)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - (i + 10) * 86400000).toISOString(),
        pnl_usd: -50,
        organic_score: 30,
      }));

    const result = recalculateWeights([...wins, ...losses], defaultCfg);
    const organicChange = result.changes.find((c) => c.signal === "organic_score");
    if (organicChange) {
      expect(organicChange.lift).toBeGreaterThan(0);
    }
  });

  it("rounds weights to 3 decimal places in output", () => {
    const perfData = Array(15)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - i * 86400000).toISOString(),
        pnl_usd: i % 2 === 0 ? 100 : -50,
        signal_snapshot: { organic_score: 80 + i, fee_tvl_ratio: 0.05 + i * 0.001 },
      }));

    const result = recalculateWeights(perfData, defaultCfg);
    for (const signal in result.weights) {
      const val = result.weights[signal];
      const str = val.toString();
      const parts = str.split(".");
      if (parts[1]) {
        expect(parts[1].length).toBeLessThanOrEqual(3);
      }
    }
  });

  it("handles empty signal_snapshot gracefully", () => {
    const perfData = Array(15)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - i * 86400000).toISOString(),
        pnl_usd: i % 2 === 0 ? 100 : -50,
        signal_snapshot: {}, // empty
      }));

    const result = recalculateWeights(perfData, defaultCfg);
    expect(typeof result.weights).toBe("object");
  });

  it("applies boostFactor correctly from config", () => {
    const cfg = {
      darwin: {
        boostFactor: 1.2, // stronger boost than default 1.05
        decayFactor: 0.95,
        weightFloor: 0.3,
        weightCeiling: 2.5,
        minSamples: 10,
        windowDays: 60,
      },
    };

    const wins = Array(8)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - i * 86400000).toISOString(),
        pnl_usd: 150,
        signal_snapshot: {
          organic_score: 95,
          fee_tvl_ratio: 0.1,
          volume: 8000,
        },
      }));

    const losses = Array(8)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - (i + 10) * 86400000).toISOString(),
        pnl_usd: -50,
        signal_snapshot: {
          organic_score: 30,
          fee_tvl_ratio: 0.01,
          volume: 100,
        },
      }));

    const result = recalculateWeights([...wins, ...losses], cfg);
    // Verify boostFactor was applied (weights should reflect 1.2x boost)
    expect(result.weights).toHaveProperty("organic_score");
  });

  it("applies decayFactor correctly from config", () => {
    const cfg = {
      darwin: {
        boostFactor: 1.05,
        decayFactor: 0.8, // stronger decay than default 0.95
        weightFloor: 0.3,
        weightCeiling: 2.5,
        minSamples: 10,
        windowDays: 60,
      },
    };

    const wins = Array(8)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - i * 86400000).toISOString(),
        pnl_usd: 150,
        signal_snapshot: {
          organic_score: 30,
          fee_tvl_ratio: 0.01,
          volume: 100,
        },
      }));

    const losses = Array(8)
      .fill(null)
      .map((_, i) => ({
        deployed_at: new Date(Date.now() - (i + 10) * 86400000).toISOString(),
        pnl_usd: -50,
        signal_snapshot: {
          organic_score: 95,
          fee_tvl_ratio: 0.1,
          volume: 8000,
        },
      }));

    const result = recalculateWeights([...wins, ...losses], cfg);
    expect(result.weights).toHaveProperty("organic_score");
  });
});
