// SPDX-License-Identifier: GPL-3.0-or-later

import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageJsonUrl = new URL("../node_modules/marked/package.json", import.meta.url);
const sourceUrl = new URL("../node_modules/marked/lib/marked.umd.js", import.meta.url);
const highlightPackageJsonUrl = new URL("../node_modules/@highlightjs/cdn-assets/package.json", import.meta.url);
const highlightSourceUrl = new URL("../node_modules/@highlightjs/cdn-assets/highlight.min.js", import.meta.url);
const vendorDirectoryUrl = new URL("../src/vendor/", import.meta.url);
const targetUrl = new URL("marked.umd.js", vendorDirectoryUrl);
const highlightTargetUrl = new URL("highlight.min.js", vendorDirectoryUrl);

const markedPackage = JSON.parse(await readFile(packageJsonUrl, "utf8"));
const highlightPackage = JSON.parse(await readFile(highlightPackageJsonUrl, "utf8"));
await mkdir(fileURLToPath(vendorDirectoryUrl), { recursive: true });
await copyFile(fileURLToPath(sourceUrl), fileURLToPath(targetUrl));
await copyFile(fileURLToPath(highlightSourceUrl), fileURLToPath(highlightTargetUrl));

console.log(`Vendored marked ${markedPackage.version}`);
console.log(`Vendored Highlight.js ${highlightPackage.version}`);
