// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/verify-macos-release.sh", import.meta.url));

test("macOS verification requires a successful, enabled Gatekeeper status", { skip: process.platform === "win32" }, () => {
  const directory = mkdtempSync(join(tmpdir(), "scratchpad-gatekeeper-"));
  try {
    // Stop at the nonexistent artifact after the status check. No signing or
    // mounting tools are mocked or invoked by this test.
    writeFileSync(join(directory, "spctl"), '#!/bin/sh\nprintf "%s\\n" "$TEST_GATEKEEPER_STATUS"\nexit "$TEST_GATEKEEPER_EXIT"\n', { mode: 0o755 });
    const artifact = join(directory, "missing.app");
    for (const [status, exitCode, expected] of [
      ["assessments disabled", "0", /Gatekeeper assessments must be enabled/],
      ["unknown status", "0", /Gatekeeper assessments must be enabled/],
      ["assessments enabled", "1", /Could not read Gatekeeper status/],
      ["assessments enabled", "0", /missing\.app does not exist/]
    ]) {
      const result = spawnSync("bash", [script, "--team", "B62UYUQ6C3", artifact], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}${delimiter}${process.env.PATH}`,
          TEST_GATEKEEPER_STATUS: status,
          TEST_GATEKEEPER_EXIT: exitCode
        }
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1);
      assert.match(result.stdout + result.stderr, expected);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
