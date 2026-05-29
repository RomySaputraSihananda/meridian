import { describe, it, expect, vi, beforeEach } from "vitest";
import { withRetry } from "../../resilient-client.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient 503 error then succeeds", async () => {
    const err = new Error("503 Service Unavailable");
    err.status = 503;
    const fn = vi.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after maxAttempts exhausted", async () => {
    const err = new Error("503");
    err.status = 503;
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 0 })).rejects.toThrow("503");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on 400 (non-transient) error", async () => {
    const err = new Error("400 Bad Request");
    err.status = 400;
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 0 })).rejects.toThrow("400");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("respects timeoutMs and throws timeout error", async () => {
    const fn = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 500)));
    await expect(
      withRetry(fn, { maxAttempts: 1, baseDelayMs: 0, timeoutMs: 50 })
    ).rejects.toThrow(/timeout/i);
  });
});
