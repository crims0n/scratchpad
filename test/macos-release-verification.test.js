// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

test("macOS finalization hands off stapled bytes and evidence only after verification succeeds", { skip: process.platform === "win32" }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "scratchpad-finalize-macos-")));
  try {
    const assets = join(root, "assets");
    const scripts = join(root, "scripts");
    mkdirSync(assets);
    mkdirSync(scripts);
    for (const name of ["finalize-macos-release.sh", "release-verification.mjs", "check-stable-release.mjs"]) {
      copyFileSync(new URL(`../scripts/${name}`, import.meta.url), join(scripts, name));
    }
    const fake = (name, body) => writeFileSync(join(root, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    fake("codesign", "exit 0");
    fake("xcrun", 'if [ "$1" = notarytool ]; then echo accepted; else printf "ticket" >> "$3"; fi');
    fake("plutil", 'if [ "$2" = status ]; then echo Accepted; else echo submission-id; fi');
    fake("gh", 'echo "Unexpected GitHub access" >&2; exit 99');
    writeFileSync(join(scripts, "verify-macos-release.sh"),
      '#!/bin/sh\ngrep -q ticket "$3" || exit 2\nexit "$TEST_VERIFY_EXIT"\n', { mode: 0o755 });
    const dmg = "Scratchpad_1.0.0_universal.dmg";
    const archive = "Scratchpad_1.0.0_universal.app.tar.gz";
    const evidence = join(root, "macos.json");
    writeFileSync(join(assets, archive), "signed app archive");
    for (const fail of [true, false]) {
      writeFileSync(join(assets, dmg), "signed DMG");
      const result = spawnSync("bash", [join(scripts, "finalize-macos-release.sh"), "--assets-dir", assets], {
        encoding: "utf8", env: { ...process.env, PATH: `${root}${delimiter}${process.env.PATH}`, RUNNER_TEMP: root,
          MACOS_SIGNING_IDENTITY: "test", MACOS_SIGNING_TEAM_ID: "TESTTEAM00", APPLE_API_KEY: "test",
          APPLE_API_ISSUER: "test", APPLE_API_KEY_PATH: "test", TEST_VERIFY_EXIT: fail ? "1" : "0",
          VERIFICATION_EVIDENCE_PATH: evidence, RELEASE_ARCHITECTURE: "universal", RELEASE_ID: "123", RELEASE_VERSION: "1.0.0",
          GITHUB_SHA: "a".repeat(40), GITHUB_RUN_ID: "456" }
      });
      assert.ifError(result.error);
      assert.equal(result.status, fail ? 1 : 0, result.stdout + result.stderr);
      assert.equal(readFileSync(join(assets, dmg), "utf8"), fail ? "signed DMG" : "signed DMGticket");
      assert.equal(existsSync(evidence), !fail);
    }
    const record = JSON.parse(readFileSync(evidence, "utf8"));
    assert.equal(record.platform, "macos");
    assert.equal(record.assets.find(asset => asset.name === dmg).size, Buffer.byteLength("signed DMGticket"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
