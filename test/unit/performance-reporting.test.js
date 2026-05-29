import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../paths.js", () => ({
  paths: {
    lessonsPath: "/tmp/meridian-test-perf.json",
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
import { getPerformanceSummary } from "../../lessons.js";

const PATH = "/tmp/meridian-test-perf.json";
const now = Date.now();
const oneDayAgo = now - 24 * 3600_000;
const twoDaysAgo = now - 48 * 3600_000;

function makeRecord(pnl_usd, recorded_at) {
  return { pnl_usd, recorded_at: new Date(recorded_at).toISOString(), base_mint: "Mint1" };
}

afterEach(() => {
  if (fs.existsSync(PATH)) fs.unlinkSync(PATH);
});

describe("getPerformanceSummary — net-honest (F2)", () => {
  it("returns zero stats when no performance history", () => {
    fs.writeFileSync(PATH, JSON.stringify({ lessons: [], performance: [] }));
    const s = getPerformanceSummary({ hours: 24 });
    expect(s.all_time.count).toBe(0);
    expect(s.all_time.net_pnl_usd).toBe(0);
  });

  it("reveals earlier window as net-negative (F2 scenario)", () => {
    // Simulate: 21 trades in last 24h = +$25.42, 40 trades before = -$12.97
    // All-time = +$12.45
    const recent21 = Array.from({ length: 21 }, (_, i) =>
      makeRecord(25.42 / 21, now - i * 60_000) // spread over last hour
    );
    const older40 = Array.from({ length: 40 }, (_, i) =>
      makeRecord(-12.97 / 40, twoDaysAgo - i * 60_000)
    );
    fs.writeFileSync(PATH, JSON.stringify({ lessons: [], performance: [...recent21, ...older40] }));

    const s = getPerformanceSummary({ hours: 24 });

    expect(s.all_time.count).toBe(61);
    expect(s.all_time.net_pnl_usd).toBeCloseTo(12.45, 0);
    expect(s.last_n_hours.count).toBe(21);
    expect(s.last_n_hours.net_pnl_usd).toBeCloseTo(25.42, 0);
    // The critical assertion: earlier window must be net-negative
    expect(s.before_window.net_pnl_usd).toBeLessThan(0);
    expect(s.before_window.net_pnl_usd).toBeCloseTo(-12.97, 0);
  });

  it("win_rate is computed correctly", () => {
    const records = [
      makeRecord(5, now - 1000),
      makeRecord(-2, now - 2000),
      makeRecord(3, now - 3000),
    ];
    fs.writeFileSync(PATH, JSON.stringify({ lessons: [], performance: records }));
    const s = getPerformanceSummary({ hours: 24 });
    expect(s.all_time.win_rate).toBeCloseTo(2 / 3, 2);
  });
});
