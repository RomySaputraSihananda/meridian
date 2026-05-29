import { log } from "./logger.js";

const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504, 529]);

function isTransient(err) {
  if (err?.status != null && !TRANSIENT_STATUS_CODES.has(err.status)) return false;
  const msg = String(err?.message ?? "").toLowerCase();
  return (
    TRANSIENT_STATUS_CODES.has(err?.status) ||
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry fn with exponential backoff + jitter.
 * Does not retry on 4xx (non-transient) errors.
 * @param {() => Promise<any>} fn
 * @param {{ maxAttempts?: number, baseDelayMs?: number, timeoutMs?: number }} opts
 */
export async function withRetry(fn, { maxAttempts = 3, baseDelayMs = 500, timeoutMs = 30_000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await (timeoutMs > 0
        ? Promise.race([
            fn(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
            ),
          ])
        : fn());
      return result;
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === maxAttempts) break;
      const jitter = 0.5 + Math.random() * 0.5;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) * jitter;
      log("retry", `Attempt ${attempt}/${maxAttempts} failed (${err.message}); retrying in ${Math.round(delay)}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}
