// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const keyUrl = new URL("../site/release-signing-key.asc", import.meta.url);
const setupHint = "Add the release-signing public key and fingerprint as described in docs/release-signing.md.";

function dearmor(armored) {
  const lines = armored.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "-----BEGIN PGP PUBLIC KEY BLOCK-----");
  assert.ok(start >= 0, "release-signing-key.asc must be an armored public key block");
  const blank = lines.indexOf("", start);
  const body = [];
  for (const line of lines.slice(blank + 1)) {
    if (line.startsWith("=") || line.startsWith("-----END")) break;
    body.push(line.trim());
  }
  return Buffer.from(body.join(""), "base64");
}

// RFC 4880 §12.2: a v4 fingerprint is SHA-1 over 0x99, a two-octet length,
// and the body of the first (primary) public-key packet.
export function primaryFingerprint(armored) {
  const data = dearmor(armored);
  const header = data[0];
  assert.ok(header & 0x80, "key data must start with an OpenPGP packet");
  let tag;
  let length;
  let offset;
  if (header & 0x40) {
    tag = header & 0x3f;
    const first = data[1];
    if (first < 192) [length, offset] = [first, 2];
    else if (first < 224) [length, offset] = [((first - 192) << 8) + data[2] + 192, 3];
    else if (first === 255) [length, offset] = [data.readUInt32BE(2), 6];
    else assert.fail("partial-length public key packets are not valid");
  } else {
    tag = (header >> 2) & 0x0f;
    const lengthType = header & 0x03;
    assert.notEqual(lengthType, 3, "indeterminate-length public key packets are not supported");
    const size = [1, 2, 4][lengthType];
    length = data.readUIntBE(1, size);
    offset = 1 + size;
  }
  assert.equal(tag, 6, "the first packet must be the primary public key");
  const body = data.subarray(offset, offset + length);
  assert.equal(body[0], 4, "the release-signing key must be an OpenPGP v4 key");
  const prefix = Buffer.from([0x99, (length >> 8) & 0xff, length & 0xff]);
  return createHash("sha1").update(prefix).update(body).digest("hex").toUpperCase();
}

const groupFingerprint = (fingerprint) => fingerprint.match(/.{4}/g).join(" ");

async function readPublishedFingerprint() {
  const armored = await readFile(keyUrl, "utf8").catch(() => assert.fail(`site/release-signing-key.asc is missing. ${setupHint}`));
  return groupFingerprint(primaryFingerprint(armored));
}

test("the website publishes the release-signing key's full fingerprint", async () => {
  const expected = await readPublishedFingerprint();
  const html = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
  const { document } = new JSDOM(html).window;
  assert.equal(document.getElementById("signing-fingerprint")?.textContent.trim(), expected, setupHint);
  assert.equal(document.querySelector('#verify-linux a[href="./release-signing-key.asc"]')?.textContent, "release-signing key");
});

test("the Linux verification guide publishes the same fingerprint", async () => {
  const expected = await readPublishedFingerprint();
  const guide = await readFile(new URL("../docs/verify-linux-downloads.md", import.meta.url), "utf8");
  assert.ok(guide.includes(`Fingerprint: \`${expected}\``), setupHint);
  assert.ok(!guide.includes("FINGERPRINT-PENDING"), setupHint);
});
