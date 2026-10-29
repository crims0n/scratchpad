// SPDX-License-Identifier: GPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const files = ["scripts/check-versions.mjs", "package.json", "package-lock.json", "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "RELEASE_NOTES.md", "src/index.html"];

for (const [label, newline] of [["LF", "\n"], ["CRLF", "\r\n"]]) {
  test(`version checks accept consistent ${label} files and still reject a mismatched app version`, async t => {
    const root = await mkdtemp(join(tmpdir(), "scratchpad-version-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    for (const file of files) {
      const content = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), content.replace(/\r?\n/g, newline));
    }
    const check = () => spawnSync(process.execPath, [join(root, "scripts/check-versions.mjs")], { encoding: "utf8" });
    const consistent = check();
    assert.equal(consistent.status, 0, consistent.stderr);
    const configFile = join(root, "src-tauri/tauri.conf.json");
    const config = JSON.parse(await readFile(configFile, "utf8"));
    config.version = `${config.version}-mismatch`;
    await writeFile(configFile, JSON.stringify(config));
    const mismatch = check();
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /Application versions must match/);
    assert.match(mismatch.stderr, /src-tauri\/tauri.conf.json: .*mismatch/);
  });
}
