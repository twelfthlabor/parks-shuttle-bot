import {
  mkdirSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const VALID_OUTCOMES = new Set([
  "confirmed",
  "human-intervention",
  "recovery-exhausted"
]);

function defaultBaseDir() {
  const home = homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, "Parks Shuttle Bot");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Parks Shuttle Bot");
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
  return path.join(configHome, "parks-shuttle-bot");
}

export function terminalStatePathFor(targetDate, options = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error(`Invalid terminal-state target date: ${targetDate}`);
  }
  const baseDir = options.baseDir ?? defaultBaseDir();
  return path.join(baseDir, `terminal-${targetDate}.json`);
}

export function recordTerminalState(
  targetDate,
  outcome,
  details = {},
  options = {}
) {
  if (!VALID_OUTCOMES.has(outcome)) {
    throw new Error(`Invalid terminal-state outcome: ${outcome}`);
  }
  const filePath = terminalStatePathFor(targetDate, options);
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const payload = {
    targetDate,
    outcome,
    recordedAt: (options.now ?? new Date()).toISOString(),
    details
  };
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  renameSync(temporaryPath, filePath);
  return { filePath, payload };
}
