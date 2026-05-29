import { describe, it, expect } from "vitest";
import { computeDeployAmount } from "../../config.js";

describe("computeDeployAmount", () => {
  // Default config values from config.js:
  // gasReserve: 0.2
  // positionSizePct: 0.35
  // deployAmountSol: 0.5 (floor)
  // maxDeployAmount: 50 (ceil)

  it("returns floor when wallet is too small", () => {
    // wallet=0.8, deployable=0.6, dynamic=0.21 < floor → returns 0.5
    const result = computeDeployAmount(0.8);
    expect(result).toBe(0.5);
  });

  it("returns floor for wallet equal to gasReserve", () => {
    // wallet=0.2, deployable=0, dynamic=0 < floor → returns 0.5
    const result = computeDeployAmount(0.2);
    expect(result).toBe(0.5);
  });

  it("returns floor for wallet below gasReserve", () => {
    // wallet=0.1, deployable=0 (clamped), dynamic=0 < floor → returns 0.5
    const result = computeDeployAmount(0.1);
    expect(result).toBe(0.5);
  });

  it("scales proportionally as wallet grows", () => {
    const small = computeDeployAmount(2.0);
    const medium = computeDeployAmount(5.0);
    const large = computeDeployAmount(10.0);

    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);
  });

  it("computes correct scaled value for mid-range wallet", () => {
    // wallet=3.0, deployable=2.8, dynamic=2.8*0.35=0.98
    // result = min(50, max(0.5, 0.98)) = 0.98
    const result = computeDeployAmount(3.0);
    expect(result).toBeCloseTo(0.98, 1);
  });

  it("computes correct scaled value for larger wallet", () => {
    // wallet=4.0, deployable=3.8, dynamic=3.8*0.35=1.33
    // result = min(50, max(0.5, 1.33)) = 1.33
    const result = computeDeployAmount(4.0);
    expect(result).toBeCloseTo(1.33, 1);
  });

  it("never exceeds maxDeployAmount ceiling", () => {
    const result = computeDeployAmount(1000);
    expect(result).toBeLessThanOrEqual(50);
    expect(result).toBe(50);
  });

  it("never goes below floor", () => {
    const result = computeDeployAmount(0.5);
    expect(result).toBeGreaterThanOrEqual(0.5);
  });

  it("returns values rounded to 2 decimal places", () => {
    // wallet=2.5, deployable=2.3, dynamic=0.805 → result=0.80 or 0.81
    const result = computeDeployAmount(2.5);
    const str = result.toString();
    const parts = str.split(".");
    if (parts[1]) {
      expect(parts[1].length).toBeLessThanOrEqual(2);
    }
  });

  it("computes example from CLAUDE.md: 2.0 SOL wallet", () => {
    // From CLAUDE.md: 2.0 SOL wallet → 0.63 SOL deploy
    // wallet=2.0, deployable=1.8, dynamic=0.63 → result=0.63
    const result = computeDeployAmount(2.0);
    expect(result).toBeCloseTo(0.63, 1);
  });

  it("enforces floor over undersized dynamic calculation", () => {
    // wallet=1.0, deployable=0.8, dynamic=0.28 < floor 0.5
    const result = computeDeployAmount(1.0);
    expect(result).toBe(0.5);
  });

  it("respects positive scaling with zero wallet balance edge case", () => {
    // wallet=0, deployable=0, dynamic=0 < floor
    const result = computeDeployAmount(0);
    expect(result).toBe(0.5);
  });
});
