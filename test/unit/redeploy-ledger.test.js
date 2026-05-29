import { describe, it, expect, vi, afterEach } from "vitest";

// Mock lessons.js file I/O
vi.mock("../../paths.js", () => ({
  paths: {
    lessonsPath: "/tmp/meridian-test-lessons.json",
    userConfigPath: "/tmp/meridian-test-user-config.json",
  }
}));
vi.mock("../../logger.js", () => ({ log: vi.fn(), logAction: vi.fn() }));
vi.mock("../../hivemind.js", () => ({
  getSharedLessonsForPrompt: vi.fn(async () => []),
  pushHiveLesson: vi.fn(),
  pushHivePerformanceEvent: vi.fn(),
}));

import fs from "fs";
import { getTokenNetPnl } from "../../lessons.js";

const LESSONS_PATH = "/tmp/meridian-test-lessons.json";

function seedPerformance(records) {
  const data = { lessons: [], performance: records };
  fs.writeFileSync(LESSONS_PATH, JSON.stringify(data));
}

afterEach(() => {
  if (fs.existsSync(LESSONS_PATH)) fs.unlinkSync(LESSONS_PATH);
});

describe("getTokenNetPnl", () => {
  it("returns 0 when no performance history", () => {
    seedPerformance([]);
    expect(getTokenNetPnl("MintABC")).toBe(0);
  });

  it("returns 0 for unknown base mint", () => {
    seedPerformance([{ base_mint: "MintABC", pnl_usd: 5 }]);
    expect(getTokenNetPnl("MintXYZ")).toBe(0);
  });

  it("sums pnl_usd across multiple positions for same token", () => {
    seedPerformance([
      { base_mint: "MintABC", pnl_usd: 2.5 },
      { base_mint: "MintABC", pnl_usd: -5.0 },
      { base_mint: "MintABC", pnl_usd: 1.0 },
    ]);
    expect(getTokenNetPnl("MintABC")).toBeCloseTo(-1.5);
  });

  it("returns negative when cumulative is net-negative", () => {
    seedPerformance([
      { base_mint: "TokenBad", pnl_usd: -3 },
      { base_mint: "TokenBad", pnl_usd: -2 },
    ]);
    expect(getTokenNetPnl("TokenBad")).toBeLessThan(0);
  });

  it("returns positive when cumulative is net-positive", () => {
    seedPerformance([
      { base_mint: "TokenGood", pnl_usd: 5 },
      { base_mint: "TokenGood", pnl_usd: 3 },
    ]);
    expect(getTokenNetPnl("TokenGood")).toBeGreaterThan(0);
  });

  it("ignores records for other tokens", () => {
    seedPerformance([
      { base_mint: "TokenA", pnl_usd: -100 },
      { base_mint: "TokenB", pnl_usd: 5 },
    ]);
    expect(getTokenNetPnl("TokenB")).toBeCloseTo(5);
  });
});
