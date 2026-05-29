import { describe, it, expect } from "vitest";
import { formatLogLine } from "../../logger.js";

describe("formatLogLine", () => {
  it("emits valid JSON with required fields", () => {
    const line = formatLogLine("test_event", "hello world", "cycle-123");
    const parsed = JSON.parse(line);
    expect(parsed.ts).toBeDefined();
    expect(parsed.event).toBe("test_event");
    expect(parsed.msg).toBe("hello world");
    expect(parsed.cycleId).toBe("cycle-123");
  });

  it("omits cycleId when not provided", () => {
    const parsed = JSON.parse(formatLogLine("evt", "msg"));
    expect(parsed.cycleId).toBeUndefined();
  });

  it("serializes objects to JSON", () => {
    const parsed = JSON.parse(formatLogLine("evt", { key: "val" }));
    expect(parsed.msg).toEqual({ key: "val" });
  });

  it("redacts sensitive keys from objects", () => {
    const line = formatLogLine("evt", { walletKey: "secret123", data: "ok" });
    expect(line).not.toContain("secret123");
    expect(line).toContain("[REDACTED]");
    expect(line).toContain("ok");
  });

  it("handles null/undefined message", () => {
    const parsed = JSON.parse(formatLogLine("evt", null));
    expect(parsed.msg).toBe("");
  });
});
