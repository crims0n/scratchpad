// SPDX-License-Identifier: GPL-3.0-or-later

import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assertApplicationBinary, readApplicationHeader } from "./verify-arm64-build.mjs";

export async function verifyLinuxPayloads({ architecture, built, binaryName, roots }) {
  if (!["x64", "arm64"].includes(architecture) || !/^[a-z0-9-]+$/.test(binaryName) || roots.length !== 2) {
    throw new Error("Expected architecture, built application, binary name and both extracted package roots");
  }
  const applications = [built, ...roots.map(root => join(root, "usr/bin", binaryName))];
  for (const file of applications) assertApplicationBinary(await readApplicationHeader(file, "linux"), "linux", architecture);
  let elfFiles = 0;
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await inspect(path); continue; }
      // Internal symlinks refer to regular files visited elsewhere in this
      // tree. External/system symlinks contain no bundled bytes to inspect.
      if (!entry.isFile()) continue;
      const file = await open(path, "r");
      try {
        const header = Buffer.alloc(64);
        const { bytesRead } = await file.read(header, 0, header.length, 0);
        if (bytesRead < 4 || header.subarray(0, 4).toString("hex") !== "7f454c46") continue;
        if (bytesRead < 64 || header[4] !== 2 || header[5] !== 1
          || header.readUInt16LE(18) !== (architecture === "arm64" ? 183 : 62)) {
          throw new Error(`Wrong or malformed ${architecture} bundled ELF payload: ${path}`);
        }
        elfFiles++;
      } finally { await file.close(); }
    }
  }
  for (const root of roots) await inspect(root);
  return { elfFiles };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [architecture, built, binaryName, ...roots] = process.argv.slice(2);
  const result = await verifyLinuxPayloads({ architecture, built, binaryName, roots });
  console.log(`Verified ${architecture} applications and ${result.elfFiles} bundled ELF files`);
}
