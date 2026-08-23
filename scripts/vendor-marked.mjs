// SPDX-License-Identifier: GPL-3.0-or-later

import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageJsonUrl = new URL("../node_modules/marked/package.json", import.meta.url);
const sourceUrl = new URL("../node_modules/marked/lib/marked.umd.js", import.meta.url);
const vendorDirectoryUrl = new URL("../src/vendor/", import.meta.url);
const targetUrl = new URL("marked.umd.js", vendorDirectoryUrl);

const markedPackage = JSON.parse(await readFile(packageJsonUrl, "utf8"));
await mkdir(fileURLToPath(vendorDirectoryUrl), { recursive: true });
await copyFile(fileURLToPath(sourceUrl), fileURLToPath(targetUrl));

console.log(`Vendored marked ${markedPackage.version}`);
