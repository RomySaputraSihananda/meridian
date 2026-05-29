import { describe, it, expect } from "vitest";

describe("assertIsolated logic", () => {
  function makeAssertIsolated(dataDir, projectRoot) {
    return function assertIsolated() {
      if (dataDir === projectRoot) {
        throw new Error(
          "Isolation guard: MERIDIAN_PROFILE=autoresearch but MERIDIAN_DATA_DIR is not set or " +
          "resolves to project root. Set MERIDIAN_DATA_DIR to a separate directory."
        );
      }
    };
  }

  it("throws when dataDir equals projectRoot", () => {
    const check = makeAssertIsolated("/proj", "/proj");
    expect(() => check()).toThrow(/isolation guard/i);
  });

  it("does not throw when dataDir differs from projectRoot", () => {
    const check = makeAssertIsolated("/tmp/isolated", "/proj");
    expect(() => check()).not.toThrow();
  });

  it("throws when both paths are the same absolute path", () => {
    const check = makeAssertIsolated("/home/romy/my-project/meridian-romy", "/home/romy/my-project/meridian-romy");
    expect(() => check()).toThrow(/isolation guard/i);
  });

  it("does not throw for any non-matching directory", () => {
    const check = makeAssertIsolated("/tmp/meridian-autoresearch-profile", "/home/romy/my-project/meridian-romy");
    expect(() => check()).not.toThrow();
  });
});
