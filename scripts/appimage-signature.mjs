// SPDX-License-Identifier: GPL-3.0-or-later

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

async function readExactly(file, size, position) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await file.read(bytes, offset, size - offset, position + offset);
    if (!bytesRead) throw new Error("Truncated AppImage ELF metadata");
    offset += bytesRead;
  }
  return bytes;
}

// appimagetool signs the 64 ASCII hex digest bytes before embedding signature
// and key data. Restore those two reserved sections to zeros when hashing.
// https://github.com/AppImage/AppImageKit/blob/master/src/appimagetool_sign.c
export async function appImageSigningData(path) {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const header = await readExactly(file, 64, 0);
    if (header.subarray(0, 6).toString("hex") !== "7f454c460201") throw new Error("Expected little-endian ELF64 AppImage");
    const tableOffset = Number(header.readBigUInt64LE(40));
    const entrySize = header.readUInt16LE(58);
    const count = header.readUInt16LE(60);
    const namesIndex = header.readUInt16LE(62);
    const tableEnd = tableOffset + entrySize * count;
    if (!Number.isSafeInteger(tableOffset) || tableOffset < 64 || entrySize < 64 || entrySize > 1024
      || !count || count > 8192 || !namesIndex || namesIndex >= count || tableEnd > size) {
      throw new Error("Invalid AppImage ELF section table");
    }
    const table = await readExactly(file, entrySize * count, tableOffset);
    const section = index => {
      const offset = index * entrySize;
      return { nameIndex: table.readUInt32LE(offset), type: table.readUInt32LE(offset + 4),
        offset: Number(table.readBigUInt64LE(offset + 24)), size: Number(table.readBigUInt64LE(offset + 32)) };
    };
    const valid = section => Number.isSafeInteger(section.offset) && Number.isSafeInteger(section.size)
      && section.offset >= 64 && section.size > 0 && section.size <= 1024 * 1024 && section.offset + section.size <= size;
    const namesSection = section(namesIndex);
    if (!valid(namesSection) || namesSection.type !== 3) throw new Error("Invalid AppImage section names");
    const names = await readExactly(file, namesSection.size, namesSection.offset);
    const masked = [];
    for (let index = 1; index < count; index++) {
      const current = section(index);
      const end = names.indexOf(0, current.nameIndex);
      if (current.nameIndex >= names.length || end < 0) throw new Error("Invalid AppImage section name");
      const name = names.subarray(current.nameIndex, end).toString();
      if (![".sha256_sig", ".sig_key"].includes(name)) continue;
      if (!valid(current) || current.type !== 1) throw new Error("Invalid AppImage signing section");
      masked.push({ ...current, name });
    }
    if (masked.length !== 2 || new Set(masked.map(section => section.name)).size !== 2) {
      throw new Error("Expected exactly one AppImage signature and key section");
    }
    const ranges = [...masked, { offset: 0, size: 64 }, { offset: tableOffset, size: tableEnd - tableOffset }, namesSection]
      .sort((a, b) => a.offset - b.offset);
    if (ranges.some((range, index) => index && ranges[index - 1].offset + ranges[index - 1].size > range.offset)) {
      throw new Error("Overlapping AppImage signing metadata");
    }
    const signatureSection = masked.find(section => section.name === ".sha256_sig");
    const raw = await readExactly(file, signatureSection.size, signatureSection.offset);
    const zero = raw.indexOf(0);
    if (zero >= 0 && raw.subarray(zero).some(byte => byte !== 0)) throw new Error("Malformed AppImage signature padding");
    const signature = zero < 0 ? raw : raw.subarray(0, zero);
    if (!signature.toString().startsWith("-----BEGIN PGP SIGNATURE-----")) throw new Error("Missing embedded AppImage signature");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    for (let position = 0; position < size;) {
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, size - position), position);
      if (!bytesRead) throw new Error("AppImage changed while hashing");
      const chunk = buffer.subarray(0, bytesRead);
      for (const section of masked) {
        const start = Math.max(position, section.offset);
        const end = Math.min(position + bytesRead, section.offset + section.size);
        if (end > start) chunk.fill(0, start - position, end - position);
      }
      hash.update(chunk);
      position += bytesRead;
    }
    return { digest: hash.digest("hex"), signature };
  } finally { await file.close(); }
}

export async function verifyAppImageSignature(path, publicKey) {
  const home = await mkdtemp("/tmp/sp-appimage-");
  try {
    const { digest, signature } = await appImageSigningData(path);
    const keyring = join(home, "published.gpg");
    const signatureFile = join(home, "signature.asc");
    const digestFile = join(home, "digest");
    await writeFile(signatureFile, signature);
    await writeFile(digestFile, digest); // no newline: matches appimagetool
    execFileSync("gpg", ["--batch", "--no-options", "--homedir", home, "--dearmor", "--output", keyring, publicKey], { stdio: "pipe" });
    execFileSync("gpgv", ["--homedir", home, "--keyring", keyring, signatureFile, digestFile], { stdio: "pipe" });
  } catch (cause) {
    throw new Error(`AppImage signature did not verify with the published key: ${path}`, { cause });
  } finally { await rm(home, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [path, publicKey] = process.argv.slice(2);
  await verifyAppImageSignature(path, publicKey);
  console.log(`Verified embedded AppImage signature: ${path}`);
}
