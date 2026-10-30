// SPDX-License-Identifier: GPL-3.0-or-later

import { assertApplicationBinary, readApplicationHeader } from "./verify-arm64-build.mjs";

// Called on the native build runner after extracting both staged packages.
const [architecture, ...files] = process.argv.slice(2);
if (!["x64", "arm64"].includes(architecture) || files.length !== 3) {
  throw new Error("Expected architecture and built, DEB and AppImage application paths");
}
for (const file of files) {
  assertApplicationBinary(await readApplicationHeader(file, "linux"), "linux", architecture);
  console.log(`Verified ${architecture} ELF application: ${file}`);
}
