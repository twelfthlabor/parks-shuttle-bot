import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  recordTerminalState,
  terminalStatePathFor
} from "../src/terminal-state.mjs";

test("records a durable target-specific terminal booking state", () => {
  const baseDir = mkdtempSync(path.join(tmpdir(), "moraine-terminal-state-"));
  try {
    const now = new Date("2026-07-30T14:00:01.000Z");
    const result = recordTerminalState(
      "2026-08-01",
      "confirmed",
      { slotName: "6:30am-7am (Last Minute)", held: true },
      { baseDir, now }
    );
    assert.equal(
      result.filePath,
      terminalStatePathFor("2026-08-01", { baseDir })
    );
    assert.deepEqual(
      JSON.parse(readFileSync(result.filePath, "utf8")),
      {
        targetDate: "2026-08-01",
        outcome: "confirmed",
        recordedAt: "2026-07-30T14:00:01.000Z",
        details: {
          slotName: "6:30am-7am (Last Minute)",
          held: true
        }
      }
    );
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("rejects invalid terminal outcomes and target dates", () => {
  assert.throws(
    () => recordTerminalState("2026-08-01", "retry"),
    /Invalid terminal-state outcome/
  );
  assert.throws(
    () => terminalStatePathFor("August 1"),
    /Invalid terminal-state target date/
  );
});
