import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../paths.js", () => ({
  paths: {
    lessonsPath: "/tmp/meridian-test-reconcile.json",
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
import { getWalletReconciliation } from "../../lessons.js";

const PATH = "/tmp/meridian-test-reconcile.json";

afterEach(() => {
  if (fs.existsSync(PATH)) fs.unlinkSync(PATH);
});

describe("getWalletReconciliation (F3)", () => {
  it("returns null when no performance history", () => {
    fs.writeFileSync(PATH, JSON.stringify({ lessons: [], performance: [] }));
    expect(getWalletReconciliation()).toBeNull();
  });

  it("returns null when no records have both reported and realized values", () => {
    fs.writeFileSync(PATH, JSON.stringify({ lessons: [], performance: [
      { base_mint: "A", pnl_sol: 0.05 } // no realized_sol
    ]}));
    expect(getWalletReconciliation()).toBeNull();
  });

  it("returns null when records only have pnl_usd but no realized_sol", () => {
    fs.writeFileSync(PATH, JSON.stringify({ lessons: [], performance: [
      { base_mint: "A", pnl_usd: 5.0 } // no pnl_sol, no realized_sol
    ]}));
    expect(getWalletReconciliation()).toBeNull();
  });

  it("detects slippage gap when realized < reported (pnl_sol path)", () => {
    fs.writeFileSync(PATH, JSON.stringify({ lessons: [], performance: [
      { base_mint: "A", pnl_sol: 0.05, realized_sol: 0.04 },
      { base_mint: "B", pnl_sol: 0.08, realized_sol: 0.07 },
    ]}));
    const r = getWalletReconciliation();
    expect(r).not.toBeNull();
    // 0.11 realized - 0.13 reported = -0.02
    expect(r.gap_sol).toBeCloseTo(-0.02, 4);
    expect(r.note).toMatch(/slippage/i);
    expect(r.reconcilable_count).toBe(2);
    expect(r.total_count).toBe(2);
  });

  it("detects slippage gap using pnl_usd / sol_price fallback", () => {
    fs.writeFileSync(PATH, JSON.stringify({ lessons: [], performance: [
      // sol_price = 200, pnl_usd = 10 → pnl_sol = 0.05; realized = 0.04
      { base_mint: "A", pnl_usd: 10.0, sol_price: 200, realized_sol: 0.04 },
    ]}));
    const r = getWalletReconciliation();
    expect(r).not.toBeNull();
    expect(r.reported_pnl_sol).toBeCloseTo(0.05, 6);
    expect(r.realized_sol).toBeCloseTo(0.04, 6);
    expect(r.gap_sol).toBeCloseTo(-0.01, 6);
    expect(r.note).toMatch(/slippage/i);
  });

  it("reports gap_pct within tolerance for small slippage", () => {
    fs.writeFileSync(PATH, JSON.stringify({ lessons: [], performance: [
      { base_mint: "A", pnl_sol: 1.0, realized_sol: 0.97 } // 3% slippage
    ]}));
    const r = getWalletReconciliation();
    expect(r.gap_pct).toBeCloseTo(-3, 0);
  });

  it("reconciles correctly when realized equals reported", () => {
    fs.writeFileSync(PATH, JSON.stringify({ lessons: [], performance: [
      { base_mint: "A", pnl_sol: 0.1, realized_sol: 0.1 },
    ]}));
    const r = getWalletReconciliation();
    expect(r.gap_sol).toBeCloseTo(0, 6);
    expect(r.note).toBe("Within tolerance");
  });

  it("reports positive gap when realized exceeds reported (better than expected)", () => {
    fs.writeFileSync(PATH, JSON.stringify({ lessons: [], performance: [
      { base_mint: "A", pnl_sol: 0.05, realized_sol: 0.06 },
    ]}));
    const r = getWalletReconciliation();
    expect(r.gap_sol).toBeCloseTo(0.01, 6);
    expect(r.note).toBe("Within tolerance");
  });

  it("skips records missing realized_sol and counts only reconcilable ones", () => {
    fs.writeFileSync(PATH, JSON.stringify({ lessons: [], performance: [
      { base_mint: "A", pnl_sol: 0.05, realized_sol: 0.04 },
      { base_mint: "B", pnl_sol: 0.08 }, // no realized_sol — skipped
      { base_mint: "C", pnl_sol: 0.03, realized_sol: 0.025 },
    ]}));
    const r = getWalletReconciliation();
    expect(r.reconcilable_count).toBe(2);
    expect(r.total_count).toBe(3);
    // Only A and C are reconciled: reported=0.08, realized=0.065
    expect(r.reported_pnl_sol).toBeCloseTo(0.08, 6);
    expect(r.realized_sol).toBeCloseTo(0.065, 6);
  });

  it("returns null when gap_pct is null for zero reported PnL", () => {
    fs.writeFileSync(PATH, JSON.stringify({ lessons: [], performance: [
      { base_mint: "A", pnl_sol: 0, realized_sol: -0.001 },
    ]}));
    const r = getWalletReconciliation();
    expect(r.gap_pct).toBeNull();
  });
});
