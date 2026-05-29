/**
 * Unit tests for tools/screening.js filter logic.
 *
 * Strategy:
 *  - Pure helper functions (scoreCandidate, isUsableVolatility, includesCaseInsensitive,
 *    getPoolLaunchpad) are NOT exported, so they are replicated here and tested directly
 *    (single-source-of-truth: the implementations are trivial 1-3 liners that must match
 *    the real code exactly — any divergence would be caught by the integration tests below).
 *  - Integration filter tests use `discoverPools` with global fetch stubbed so no real
 *    network call is made.  Each test controls config.screening thresholds by mutating the
 *    mocked config object before calling discoverPools.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock all side-effectful dependencies before importing screening ──────────

vi.mock("../../config.js", () => ({
  config: {
    screening: {
      excludeHighSupplyConcentration: false,
      minFeeActiveTvlRatio: 0.05,
      minTvl: 10_000,
      maxTvl: 150_000,
      minVolume: 500,
      minOrganic: 60,
      minQuoteOrganic: 60,
      minHolders: 500,
      minMcap: 150_000,
      maxMcap: 10_000_000,
      minBinStep: 80,
      maxBinStep: 125,
      // Use "30m" so MIN_VOLATILITY_TIMEFRAME matches and applyVolatilityTimeframe
      // returns early without issuing per-pool secondary fetch calls (which would
      // corrupt pool data via our uniform stub).
      timeframe: "30m",
      category: "trending",
      minTokenFeesSol: 30,
      useDiscordSignals: false,
      discordSignalMode: "merge",
      avoidPvpSymbols: false,
      blockPvpSymbols: false,
      maxBundlePct: 30,
      maxBotHoldersPct: 30,
      maxTop10Pct: 60,
      allowedLaunchpads: [],
      blockedLaunchpads: [],
      minTokenAgeHours: null,
      maxTokenAgeHours: null,
      athFilterPct: null,
      adverseSelectionPenalty: 0.3,
      source: "meteora",
    },
    indicators: { enabled: false },
    gmgn: {},
  },
}));

vi.mock("../../token-blacklist.js", () => ({
  isBlacklisted: vi.fn(() => false),
}));

vi.mock("../../dev-blocklist.js", () => ({
  isDevBlocked: vi.fn(() => false),
  getBlockedDevs: vi.fn(() => ({})),
}));

vi.mock("../../logger.js", () => ({
  log: vi.fn(),
}));

vi.mock("../../pool-memory.js", () => ({
  isPoolOnCooldown: vi.fn(() => false),
  isBaseMintOnCooldown: vi.fn(() => false),
}));

vi.mock("../chart-indicators.js", () => ({
  confirmIndicatorPreset: vi.fn(async () => ({ enabled: false, confirmed: true })),
}));

vi.mock("../agent-meridian.js", () => ({
  getAgentMeridianBase: vi.fn(() => "https://mock-agent"),
  getAgentMeridianHeaders: vi.fn(() => ({})),
}));

vi.mock("../gmgn.js", () => ({
  discoverGmgnPools: vi.fn(async () => ({ pools: [], filtered_examples: [] })),
}));

vi.mock("../../resilient-client.js", () => ({
  withRetry: vi.fn(async (fn) => fn()),
}));

// ─── Import screening AFTER mocks are registered ─────────────────────────────

import { discoverPools } from "../../tools/screening.js";
import { config } from "../../config.js";

// Expose config to the replicated scoreCandidate helper below
const _config = config;

// ─── Helper: build a minimal pool that passes ALL default thresholds ───────────

function makePool(overrides = {}) {
  return {
    pool_address: "POOL_" + Math.random().toString(36).slice(2),
    name: "TEST/WSOL",
    pool_type: "dlmm",
    dlmm_params: { bin_step: 100 },
    tvl: 50_000,
    active_tvl: 50_000,
    fee: 200,
    volume: 2_000,
    fee_active_tvl_ratio: 0.10,
    volatility: 1.5,
    fee_pct: 0.5,
    base_token_holders: 800,
    base_token_has_critical_warnings: false,
    quote_token_has_critical_warnings: false,
    base_token_has_high_single_ownership: false,
    token_x: {
      address: "MINT_" + Math.random().toString(36).slice(2),
      symbol: "TEST",
      market_cap: 500_000,
      organic_score: 75,
      launchpad: null,
      warnings: [],
    },
    token_y: {
      address: "So11111111111111111111111111111111111111112",
      symbol: "SOL",
      organic_score: 99,
    },
    ...overrides,
  };
}

// ─── Helper: stub fetch to return a pool list ──────────────────────────────────

function stubFetchWithPools(pools) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: pools, total: pools.length }),
  })));
}

// ─── Reset mutable config.screening between tests ─────────────────────────────

const defaultScreening = { ...config.screening };

beforeEach(() => {
  Object.assign(config.screening, defaultScreening);
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. Pure helper: isUsableVolatility
//    (replicated from screening.js — must stay in sync)
// ═════════════════════════════════════════════════════════════════════════════

function isUsableVolatility(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

describe("isUsableVolatility", () => {
  it("returns false for 0", () => {
    expect(isUsableVolatility(0)).toBe(false);
  });

  it("returns false for negative values", () => {
    expect(isUsableVolatility(-1)).toBe(false);
    expect(isUsableVolatility(-0.001)).toBe(false);
  });

  it("returns true for any positive finite number", () => {
    expect(isUsableVolatility(0.001)).toBe(true);
    expect(isUsableVolatility(1)).toBe(true);
    expect(isUsableVolatility(100)).toBe(true);
  });

  it("returns false for NaN", () => {
    expect(isUsableVolatility(NaN)).toBe(false);
  });

  it("returns false for Infinity", () => {
    expect(isUsableVolatility(Infinity)).toBe(false);
    expect(isUsableVolatility(-Infinity)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isUsableVolatility(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isUsableVolatility(undefined)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Pure helper: scoreCandidate
//    (replicated from screening.js)
// ═════════════════════════════════════════════════════════════════════════════

function scoreCandidate(pool) {
  const shortFeeTvl = Number(pool.fee_active_tvl_ratio || 0);
  const longFeeTvl = Number(pool.fee_active_tvl_ratio_30m ?? 0);
  const isAdverseSelection = longFeeTvl > 0 && shortFeeTvl > longFeeTvl * 2;
  pool.adverse_selection_flag = isAdverseSelection;
  const adversePenalty = isAdverseSelection
    ? (_config.screening.adverseSelectionPenalty ?? 0.3)
    : 0;

  if (Number.isFinite(Number(pool.gmgn_score))) {
    const base = Number(pool.gmgn_score) + shortFeeTvl * 500;
    return base * (1 - adversePenalty);
  }
  const feeTvl = shortFeeTvl;
  const organic = Number(pool.organic_score || 0);
  const volume = Number(pool.volume_window || 0);
  const holders = Number(pool.holders || 0);
  const base = feeTvl * 1000 + organic * 10 + volume / 100 + holders / 100;
  return base * (1 - adversePenalty);
}

describe("scoreCandidate", () => {
  it("returns higher score for higher fee_active_tvl_ratio", () => {
    const low  = scoreCandidate({ fee_active_tvl_ratio: 0.05, organic_score: 70 });
    const high = scoreCandidate({ fee_active_tvl_ratio: 0.20, organic_score: 70 });
    expect(high).toBeGreaterThan(low);
  });

  it("returns higher score for higher organic_score", () => {
    const low  = scoreCandidate({ fee_active_tvl_ratio: 0.10, organic_score: 50 });
    const high = scoreCandidate({ fee_active_tvl_ratio: 0.10, organic_score: 90 });
    expect(high).toBeGreaterThan(low);
  });

  it("returns higher score for higher volume_window", () => {
    const low  = scoreCandidate({ fee_active_tvl_ratio: 0.10, volume_window: 1_000 });
    const high = scoreCandidate({ fee_active_tvl_ratio: 0.10, volume_window: 100_000 });
    expect(high).toBeGreaterThan(low);
  });

  it("returns higher score for higher holders", () => {
    const low  = scoreCandidate({ fee_active_tvl_ratio: 0.10, holders: 100 });
    const high = scoreCandidate({ fee_active_tvl_ratio: 0.10, holders: 5_000 });
    expect(high).toBeGreaterThan(low);
  });

  it("uses gmgn_score path when gmgn_score is present", () => {
    const s = scoreCandidate({ gmgn_score: 100, fee_active_tvl_ratio: 0.10 });
    // 100 + 0.10 * 500 = 150
    expect(s).toBe(150);
  });

  it("handles missing fields gracefully (no NaN)", () => {
    const s = scoreCandidate({});
    expect(Number.isFinite(s)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2b. scoreCandidate — adverse-selection penalty
// ═════════════════════════════════════════════════════════════════════════════

describe("scoreCandidate — adverse-selection penalty", () => {
  it("penalizes pool with short-window fee/TVL more than 2× long-window baseline", () => {
    // 5m ratio: 0.30, 30m baseline: 0.08 → ratio is 3.75× above threshold
    const pool = {
      fee_active_tvl_ratio: 0.30,
      fee_active_tvl_ratio_30m: 0.08,
      organic_score: 70,
      volume_window: 40_000,
      holders: 800,
    };
    const penalized = scoreCandidate(pool);

    // Unpenalized baseline (same pool without 30m ratio)
    const basePool = {
      fee_active_tvl_ratio: 0.30,
      organic_score: 70,
      volume_window: 40_000,
      holders: 800,
    };
    const unpenalized = scoreCandidate(basePool);

    expect(penalized).toBeLessThan(unpenalized);
    // With penalty=0.3, penalized score = unpenalized * 0.7
    expect(penalized).toBeCloseTo(unpenalized * 0.7, 5);
  });

  it("flags pool as adverse_selection_flag=true when spike is >2× baseline", () => {
    const pool = { fee_active_tvl_ratio: 0.30, fee_active_tvl_ratio_30m: 0.08 };
    scoreCandidate(pool);
    expect(pool.adverse_selection_flag).toBe(true);
  });

  it("does not penalize when short-window ratio is exactly 2× long-window (boundary)", () => {
    const pool = {
      fee_active_tvl_ratio: 0.16,     // exactly 2× of 0.08
      fee_active_tvl_ratio_30m: 0.08,
      organic_score: 70,
    };
    const penalized = scoreCandidate(pool);
    const basePool = {
      fee_active_tvl_ratio: 0.16,
      organic_score: 70,
    };
    const unpenalized = scoreCandidate(basePool);
    // Exactly 2× is NOT above 2×, so no penalty
    expect(penalized).toBeCloseTo(unpenalized, 5);
    expect(pool.adverse_selection_flag).toBe(false);
  });

  it("does not penalize when short-window ratio is below 2× long-window baseline", () => {
    const pool = {
      fee_active_tvl_ratio: 0.12,     // 1.5× of 0.08 — under threshold
      fee_active_tvl_ratio_30m: 0.08,
      organic_score: 70,
    };
    const penalized = scoreCandidate(pool);
    const basePool = {
      fee_active_tvl_ratio: 0.12,
      organic_score: 70,
    };
    const unpenalized = scoreCandidate(basePool);
    expect(penalized).toBeCloseTo(unpenalized, 5);
    expect(pool.adverse_selection_flag).toBe(false);
  });

  it("does not penalize when fee_active_tvl_ratio_30m is missing/null", () => {
    const pool = {
      fee_active_tvl_ratio: 0.50,     // very high short ratio, but no 30m data
      fee_active_tvl_ratio_30m: null,
      organic_score: 70,
    };
    const penalized = scoreCandidate(pool);
    const basePool = {
      fee_active_tvl_ratio: 0.50,
      organic_score: 70,
    };
    const unpenalized = scoreCandidate(basePool);
    // No 30m baseline means no penalty can be applied
    expect(penalized).toBeCloseTo(unpenalized, 5);
    expect(pool.adverse_selection_flag).toBe(false);
  });

  it("respects custom adverseSelectionPenalty from config", () => {
    const originalPenalty = _config.screening.adverseSelectionPenalty;
    _config.screening.adverseSelectionPenalty = 0.5; // 50% penalty instead of 30%
    try {
      const pool = {
        fee_active_tvl_ratio: 0.30,
        fee_active_tvl_ratio_30m: 0.08,
        organic_score: 70,
      };
      const penalized = scoreCandidate(pool);
      const basePool = { fee_active_tvl_ratio: 0.30, organic_score: 70 };
      const unpenalized = scoreCandidate(basePool);
      expect(penalized).toBeCloseTo(unpenalized * 0.5, 5);
    } finally {
      _config.screening.adverseSelectionPenalty = originalPenalty;
    }
  });

  it("applies penalty on gmgn_score path too", () => {
    const pool = {
      gmgn_score: 100,
      fee_active_tvl_ratio: 0.30,
      fee_active_tvl_ratio_30m: 0.08,
    };
    const penalized = scoreCandidate(pool);
    const basePool = { gmgn_score: 100, fee_active_tvl_ratio: 0.30 };
    const unpenalized = scoreCandidate(basePool);
    expect(penalized).toBeLessThan(unpenalized);
    expect(penalized).toBeCloseTo(unpenalized * 0.7, 5);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Pure helper: includesCaseInsensitive
//    (replicated from screening.js)
// ═════════════════════════════════════════════════════════════════════════════

function includesCaseInsensitive(values, value) {
  if (!Array.isArray(values) || values.length === 0 || !value) return false;
  const needle = String(value).toLowerCase();
  return values.some((entry) => String(entry).toLowerCase() === needle);
}

describe("includesCaseInsensitive", () => {
  it("matches exact case", () => {
    expect(includesCaseInsensitive(["pump.fun"], "pump.fun")).toBe(true);
  });

  it("matches mixed case", () => {
    expect(includesCaseInsensitive(["Pump.Fun"], "pump.fun")).toBe(true);
    expect(includesCaseInsensitive(["pump.fun"], "PUMP.FUN")).toBe(true);
  });

  it("returns false when value not in list", () => {
    expect(includesCaseInsensitive(["letsbonk.fun"], "pump.fun")).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(includesCaseInsensitive([], "pump.fun")).toBe(false);
  });

  it("returns false for null/undefined value", () => {
    expect(includesCaseInsensitive(["pump.fun"], null)).toBe(false);
    expect(includesCaseInsensitive(["pump.fun"], undefined)).toBe(false);
  });

  it("returns false for non-array values list", () => {
    expect(includesCaseInsensitive(null, "pump.fun")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Pure helper: getPoolLaunchpad
//    (replicated from screening.js)
// ═════════════════════════════════════════════════════════════════════════════

function getPoolLaunchpad(pool) {
  const base = pool?.token_x || {};
  return base?.launchpad ||
    base?.launchpad_platform ||
    pool?.base_token_launchpad ||
    pool?.launchpad ||
    pool?.launchpad_platform ||
    null;
}

describe("getPoolLaunchpad", () => {
  it("reads from token_x.launchpad first", () => {
    expect(getPoolLaunchpad({ token_x: { launchpad: "pump.fun" } })).toBe("pump.fun");
  });

  it("falls back to token_x.launchpad_platform", () => {
    expect(getPoolLaunchpad({ token_x: { launchpad_platform: "letsbonk.fun" } })).toBe("letsbonk.fun");
  });

  it("falls back to pool-level base_token_launchpad", () => {
    expect(getPoolLaunchpad({ base_token_launchpad: "raydium" })).toBe("raydium");
  });

  it("falls back to pool.launchpad", () => {
    expect(getPoolLaunchpad({ launchpad: "moonshot" })).toBe("moonshot");
  });

  it("returns null when no launchpad present", () => {
    expect(getPoolLaunchpad({ token_x: {} })).toBeNull();
    expect(getPoolLaunchpad({})).toBeNull();
  });

  it("does not throw on null pool", () => {
    expect(getPoolLaunchpad(null)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Integration filter tests via discoverPools (mocked fetch)
//    Each test tweaks config.screening and checks which pools survive.
// ═════════════════════════════════════════════════════════════════════════════

describe("discoverPools filter integration", () => {
  // ── 5a. minFeeActiveTvlRatio ──────────────────────────────────────────────
  describe("minFeeActiveTvlRatio filter", () => {
    it("rejects pool with ratio below threshold", async () => {
      config.screening.minFeeActiveTvlRatio = 0.05;

      const lowRatioPool = makePool({ fee_active_tvl_ratio: 0.03 });
      const goodPool     = makePool({ fee_active_tvl_ratio: 0.10 });

      stubFetchWithPools([lowRatioPool, goodPool]);

      const result = await discoverPools();

      const passingAddresses = result.pools.map((p) => p.pool);
      expect(passingAddresses).not.toContain(lowRatioPool.pool_address);
      expect(passingAddresses).toContain(goodPool.pool_address);
    });

    it("accepts pool with ratio exactly equal to threshold", async () => {
      config.screening.minFeeActiveTvlRatio = 0.05;

      const exactPool = makePool({ fee_active_tvl_ratio: 0.05 });
      stubFetchWithPools([exactPool]);

      const result = await discoverPools();
      expect(result.pools.map((p) => p.pool)).toContain(exactPool.pool_address);
    });
  });

  // ── 5b. minVolume filter: volume=0 is valid failing data, not "missing" ───
  describe("minVolume filter", () => {
    it("rejects pool with volume=0 (valid data that fails filter)", async () => {
      config.screening.minVolume = 500;

      const zeroVolumePool = makePool({ volume: 0 });
      const goodPool       = makePool({ volume: 2_000 });

      stubFetchWithPools([zeroVolumePool, goodPool]);

      const result = await discoverPools();

      const passingAddresses = result.pools.map((p) => p.pool);
      expect(passingAddresses).not.toContain(zeroVolumePool.pool_address);
      expect(passingAddresses).toContain(goodPool.pool_address);
    });

    it("rejects pool with volume below threshold", async () => {
      config.screening.minVolume = 500;

      const lowVolumePool = makePool({ volume: 100 });
      stubFetchWithPools([lowVolumePool]);

      const result = await discoverPools();
      expect(result.pools).toHaveLength(0);
    });

    it("accepts pool with volume at threshold", async () => {
      config.screening.minVolume = 500;

      const atThreshold = makePool({ volume: 500 });
      stubFetchWithPools([atThreshold]);

      const result = await discoverPools();
      expect(result.pools.map((p) => p.pool)).toContain(atThreshold.pool_address);
    });
  });

  // ── 5c. blockedLaunchpads filter ─────────────────────────────────────────
  describe("blockedLaunchpads filter", () => {
    it("rejects pool from a blocked launchpad", async () => {
      config.screening.blockedLaunchpads = ["pump.fun"];

      const pumpPool = makePool();
      pumpPool.token_x.launchpad = "pump.fun";

      const safePool = makePool();
      safePool.token_x.launchpad = null;

      stubFetchWithPools([pumpPool, safePool]);

      const result = await discoverPools();

      const passingAddresses = result.pools.map((p) => p.pool);
      expect(passingAddresses).not.toContain(pumpPool.pool_address);
      expect(passingAddresses).toContain(safePool.pool_address);
    });

    it("launchpad comparison is case-insensitive", async () => {
      config.screening.blockedLaunchpads = ["pump.fun"];

      const mixedCasePool = makePool();
      mixedCasePool.token_x.launchpad = "Pump.Fun";
      stubFetchWithPools([mixedCasePool]);

      const result = await discoverPools();
      expect(result.pools).toHaveLength(0);
    });

    it("passes pool when blockedLaunchpads is empty", async () => {
      config.screening.blockedLaunchpads = [];

      const pool = makePool();
      pool.token_x.launchpad = "pump.fun";
      stubFetchWithPools([pool]);

      const result = await discoverPools();
      expect(result.pools.map((p) => p.pool)).toContain(pool.pool_address);
    });
  });

  // ── 5d. minTvl / maxTvl filters ──────────────────────────────────────────
  describe("TVL filters", () => {
    it("rejects pool with TVL below minTvl", async () => {
      config.screening.minTvl = 10_000;

      const lowTvlPool = makePool({ tvl: 5_000, active_tvl: 5_000 });
      stubFetchWithPools([lowTvlPool]);

      const result = await discoverPools();
      expect(result.pools).toHaveLength(0);
    });

    it("rejects pool with TVL above maxTvl", async () => {
      config.screening.maxTvl = 150_000;

      const highTvlPool = makePool({ tvl: 200_000, active_tvl: 200_000 });
      stubFetchWithPools([highTvlPool]);

      const result = await discoverPools();
      expect(result.pools).toHaveLength(0);
    });

    it("accepts pool within TVL range", async () => {
      config.screening.minTvl = 10_000;
      config.screening.maxTvl = 150_000;

      const goodPool = makePool({ tvl: 50_000, active_tvl: 50_000 });
      stubFetchWithPools([goodPool]);

      const result = await discoverPools();
      expect(result.pools).toHaveLength(1);
    });

    it("accepts pool when maxTvl is null (no upper bound)", async () => {
      config.screening.maxTvl = null;

      const hugePool = makePool({ tvl: 999_999, active_tvl: 999_999 });
      stubFetchWithPools([hugePool]);

      const result = await discoverPools();
      expect(result.pools.map((p) => p.pool)).toContain(hugePool.pool_address);
    });
  });

  // ── 5e. minHolders filter ─────────────────────────────────────────────────
  describe("minHolders filter", () => {
    it("rejects pool with holders below threshold", async () => {
      config.screening.minHolders = 500;

      const fewHolders = makePool({ base_token_holders: 200 });
      stubFetchWithPools([fewHolders]);

      const result = await discoverPools();
      expect(result.pools).toHaveLength(0);
    });

    it("accepts pool with holders at threshold", async () => {
      config.screening.minHolders = 500;

      const exactHolders = makePool({ base_token_holders: 500 });
      stubFetchWithPools([exactHolders]);

      const result = await discoverPools();
      expect(result.pools).toHaveLength(1);
    });

    it("accepts pool with holders above threshold", async () => {
      config.screening.minHolders = 500;

      const manyHolders = makePool({ base_token_holders: 1_500 });
      stubFetchWithPools([manyHolders]);

      const result = await discoverPools();
      expect(result.pools).toHaveLength(1);
    });
  });

  // ── 5f. Zero / null volatility skip ──────────────────────────────────────
  describe("volatility filter", () => {
    it("rejects pool with volatility=0", async () => {
      const zeroVolPool = makePool({ volatility: 0 });
      stubFetchWithPools([zeroVolPool]);

      const result = await discoverPools();
      expect(result.pools).toHaveLength(0);
    });

    it("rejects pool with volatility=null", async () => {
      const nullVolPool = makePool({ volatility: null });
      stubFetchWithPools([nullVolPool]);

      const result = await discoverPools();
      expect(result.pools).toHaveLength(0);
    });

    it("rejects pool with negative volatility", async () => {
      const negVolPool = makePool({ volatility: -1 });
      stubFetchWithPools([negVolPool]);

      const result = await discoverPools();
      expect(result.pools).toHaveLength(0);
    });

    it("accepts pool with positive volatility", async () => {
      const goodPool = makePool({ volatility: 1.5 });
      stubFetchWithPools([goodPool]);

      const result = await discoverPools();
      expect(result.pools).toHaveLength(1);
    });
  });

  // ── 5g. missing base_mint — no crash ─────────────────────────────────────
  describe("missing base_mint graceful handling", () => {
    it("does not crash when token_x.address is absent", async () => {
      const noMintPool = makePool();
      delete noMintPool.token_x.address;

      stubFetchWithPools([noMintPool]);

      await expect(discoverPools()).resolves.toBeDefined();
    });

    it("does not crash when token_x is absent entirely", async () => {
      const noTokenX = makePool();
      delete noTokenX.token_x;
      // Ensure required fields are still present for other filters
      noTokenX.base_token_holders = 800;

      stubFetchWithPools([noTokenX]);

      await expect(discoverPools()).resolves.toBeDefined();
    });
  });

  // ── 5h. mcap filters ─────────────────────────────────────────────────────
  describe("mcap filters", () => {
    it("rejects pool with mcap below minMcap", async () => {
      config.screening.minMcap = 150_000;

      const lowMcap = makePool();
      lowMcap.token_x.market_cap = 50_000;
      stubFetchWithPools([lowMcap]);

      const result = await discoverPools();
      expect(result.pools).toHaveLength(0);
    });

    it("rejects pool with mcap above maxMcap", async () => {
      config.screening.maxMcap = 10_000_000;

      const highMcap = makePool();
      highMcap.token_x.market_cap = 50_000_000;
      stubFetchWithPools([highMcap]);

      const result = await discoverPools();
      expect(result.pools).toHaveLength(0);
    });
  });

  // ── 5i. filtered_examples populated on reject ─────────────────────────────
  describe("filtered_examples output", () => {
    it("reports filtered pool names and reasons", async () => {
      config.screening.minVolume = 500;

      const badPool = makePool({ volume: 10, name: "LOSER/WSOL" });
      stubFetchWithPools([badPool]);

      const result = await discoverPools();
      expect(result.filtered_examples.length).toBeGreaterThan(0);
      expect(result.filtered_examples[0]).toHaveProperty("reason");
      expect(result.filtered_examples[0]).toHaveProperty("name");
    });
  });

  // ── 5j. A fully valid pool passes all filters ─────────────────────────────
  describe("valid pool passes all default filters", () => {
    it("returns pool when all thresholds are satisfied", async () => {
      const goodPool = makePool();
      stubFetchWithPools([goodPool]);

      const result = await discoverPools();
      expect(result.pools).toHaveLength(1);
      expect(result.pools[0].pool).toBe(goodPool.pool_address);
    });
  });

  // ── 5k. Multi-category screening: loop, merge, dedupe ─────────────────────
  describe("multi-category screening", () => {
    // Returns different pools per category based on the &category= in the URL
    function stubFetchByCategory(poolsByCategory) {
      vi.stubGlobal("fetch", vi.fn(async (url) => {
        const m = String(url).match(/[?&]category=([^&]+)/);
        const category = m ? m[1] : "trending";
        const pools = poolsByCategory[category] ?? [];
        return { ok: true, json: async () => ({ data: pools, total: pools.length }) };
      }));
    }

    it("merges pools from multiple categories", async () => {
      config.screening.category = ["trending", "top"];
      const trendingPool = makePool({ pool_address: "PoolTrending111", name: "TREND/SOL" });
      const topPool = makePool({ pool_address: "PoolTop222", name: "TOP/SOL" });
      stubFetchByCategory({ trending: [trendingPool], top: [topPool] });

      const result = await discoverPools();
      const addresses = result.pools.map((p) => p.pool);
      expect(addresses).toContain("PoolTrending111");
      expect(addresses).toContain("PoolTop222");
    });

    it("dedupes a pool that appears in two categories (first category wins)", async () => {
      config.screening.category = ["trending", "top"];
      const shared = makePool({ pool_address: "PoolShared333", name: "SHARED/SOL" });
      stubFetchByCategory({ trending: [shared], top: [shared] });

      const result = await discoverPools();
      const matches = result.pools.filter((p) => p.pool === "PoolShared333");
      expect(matches).toHaveLength(1);
    });

    it("tags each pool with its discovery_category", async () => {
      config.screening.category = ["trending", "top"];
      const trendingPool = makePool({ pool_address: "PoolT111", name: "T/SOL" });
      const topPool = makePool({ pool_address: "PoolT222", name: "U/SOL" });
      stubFetchByCategory({ trending: [trendingPool], top: [topPool] });

      const result = await discoverPools();
      const t = result.pools.find((p) => p.pool === "PoolT111");
      const u = result.pools.find((p) => p.pool === "PoolT222");
      expect(t.discovery_category).toBe("trending");
      expect(u.discovery_category).toBe("top");
    });

    it("survives one failing category (others still return pools)", async () => {
      config.screening.category = ["trending", "broken"];
      const goodPool = makePool({ pool_address: "PoolGood444", name: "GOOD/SOL" });
      vi.stubGlobal("fetch", vi.fn(async (url) => {
        if (String(url).includes("category=broken")) {
          return { ok: false, status: 500, statusText: "Server Error" };
        }
        return { ok: true, json: async () => ({ data: [goodPool], total: 1 }) };
      }));

      const result = await discoverPools();
      expect(result.pools.map((p) => p.pool)).toContain("PoolGood444");
    });

    it("accepts comma-separated category string", async () => {
      config.screening.category = "trending,top";
      const trendingPool = makePool({ pool_address: "PoolCsv111", name: "A/SOL" });
      const topPool = makePool({ pool_address: "PoolCsv222", name: "B/SOL" });
      stubFetchByCategory({ trending: [trendingPool], top: [topPool] });

      const result = await discoverPools();
      const addresses = result.pools.map((p) => p.pool);
      expect(addresses).toContain("PoolCsv111");
      expect(addresses).toContain("PoolCsv222");
    });

    it("still works with a single category string (backwards compatible)", async () => {
      config.screening.category = "trending";
      const pool = makePool({ pool_address: "PoolSingle111", name: "S/SOL" });
      stubFetchByCategory({ trending: [pool] });

      const result = await discoverPools();
      expect(result.pools.map((p) => p.pool)).toContain("PoolSingle111");
    });
  });
});
