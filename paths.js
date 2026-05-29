import path from "path";
import { fileURLToPath } from "url";

const __root = path.dirname(fileURLToPath(import.meta.url));

// Data directory: state, lessons, logs, cache, and all mutable JSON files.
// Defaults to project root so production behavior is unchanged.
// MERIDIAN_DATA_DIR can be an absolute path or a path relative to cwd.
const dataDir = process.env.MERIDIAN_DATA_DIR
  ? path.resolve(process.env.MERIDIAN_DATA_DIR)
  : __root;

// Config file path. Separate from dataDir so you can point at any config
// while keeping data files isolated to their profile directory.
// MERIDIAN_CONFIG_PATH can be an absolute path or a path relative to cwd.
const userConfigPath = process.env.MERIDIAN_CONFIG_PATH
  ? path.resolve(process.env.MERIDIAN_CONFIG_PATH)
  : path.join(dataDir, "user-config.json");

export const paths = {
  dataDir,
  userConfigPath,
  gmgnConfigPath:    path.join(dataDir, "gmgn-config.json"),
  statePath:         path.join(dataDir, "state.json"),
  lessonsPath:       path.join(dataDir, "lessons.json"),
  poolMemoryPath:    path.join(dataDir, "pool-memory.json"),
  decisionLogPath:   path.join(dataDir, "decision-log.json"),
  hivemindCachePath:  path.join(dataDir, "hivemind-cache.json"),
  paperPositionsPath: path.join(dataDir, "paper-positions.json"),
  logDir:             path.join(dataDir, "logs"),
};

/**
 * Call at startup when MERIDIAN_PROFILE=autoresearch.
 * Throws if MERIDIAN_DATA_DIR resolves to the project root — that would clobber production state.
 */
export function assertIsolated() {
  if (dataDir === __root) {
    throw new Error(
      "Isolation guard: MERIDIAN_PROFILE=autoresearch but MERIDIAN_DATA_DIR is not set or " +
      "resolves to project root. Set MERIDIAN_DATA_DIR to a separate directory."
    );
  }
}
