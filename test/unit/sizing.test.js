import { describe, it, expect } from "vitest";
import { computeDeployAmount } from "../../config.js";

// Explicit defaults so tests are independent of user-config.json on disk
const DEFAULTS = { gasReserve: 0.2, positionSizePct: 0.35, deployAmountSol: 0.5, maxDeployAmount: 50 };
const deploy = (sol, vol = null) => computeDeployAmount(sol, vol, DEFAULTS);

describe("computeDeployAmount", () => {
  it("returns floor when wallet is too small", () => {
    // wallet=0.8, deployable=0.6, dynamic=0.21 < floor 0.5 → returns 0.5
    expect(deploy(0.8)).toBe(0.5);
  });

  it("returns floor for wallet equal to gasReserve", () => {
    expect(deploy(0.2)).toBe(0.5);
  });

  it("returns floor for wallet below gasReserve", () => {
    expect(deploy(0.1)).toBe(0.5);
  });

  it("scales proportionally as wallet grows", () => {
    expect(deploy(2.0)).toBeLessThan(deploy(5.0));
    expect(deploy(5.0)).toBeLessThan(deploy(10.0));
  });

  it("computes correct scaled value for mid-range wallet", () => {
    // wallet=3.0, deployable=2.8, dynamic=2.8*0.35=0.98
    expect(deploy(3.0)).toBeCloseTo(0.98, 1);
  });

  it("computes correct scaled value for larger wallet", () => {
    // wallet=4.0, deployable=3.8, dynamic=3.8*0.35=1.33
    expect(deploy(4.0)).toBeCloseTo(1.33, 1);
  });

  it("never exceeds maxDeployAmount ceiling", () => {
    expect(deploy(1000)).toBe(50);
  });

  it("never goes below floor", () => {
    expect(deploy(0.5)).toBeGreaterThanOrEqual(0.5);
  });

  it("returns values rounded to 2 decimal places", () => {
    const str = deploy(2.5).toString();
    const decimals = str.split(".")[1];
    if (decimals) expect(decimals.length).toBeLessThanOrEqual(2);
  });

  it("computes example from CLAUDE.md: 2.0 SOL wallet", () => {
    // wallet=2.0, deployable=1.8, dynamic=0.63 → result=0.63
    expect(deploy(2.0)).toBeCloseTo(0.63, 1);
  });

  it("enforces floor over undersized dynamic calculation", () => {
    // wallet=1.0, deployable=0.8, dynamic=0.28 < floor 0.5
    expect(deploy(1.0)).toBe(0.5);
  });

  it("respects positive scaling with zero wallet balance edge case", () => {
    expect(deploy(0)).toBe(0.5);
  });

  it("reduces size when volatility is high (> 3)", () => {
    expect(deploy(10.0, 4.0)).toBeLessThan(deploy(10.0));
  });

  it("caps scale-down at 50% (volatility=13 → factor=0.5)", () => {
    expect(deploy(10.0, 13.0)).toBeGreaterThanOrEqual(deploy(10.0) * 0.5 - 0.01);
  });
});
