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

export function terminalStatePathFor(targetDate, options = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error(`Invalid terminal-state target date: ${targetDate}`);
  }
  const baseDir = options.baseDir ?? path.join(
    homedir(),
    "Library",
    "Application Support",
    "Parks Shuttle Bot"
  );
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
