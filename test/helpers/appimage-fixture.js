// SPDX-License-Identifier: GPL-3.0-or-later
import { createHash } from "node:crypto";

// Independent ELF64 container for the AppImage signing protocol. It is not
// executable and establishes no native packaging/installability result.
export function appImageFixture(architecture, label) {
  const signatureOffset = 512;
  const keyOffset = signatureOffset + 4096;
  const payloadOffset = keyOffset + 4096;
  const bytes = Buffer.alloc(payloadOffset + 256);
  bytes.write("\x7fELF"); bytes[4] = 2; bytes[5] = 1; bytes[6] = 1;
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(architecture === "arm64" ? 183 : 62, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeBigUInt64LE(0x400100n, 24);
  bytes.writeBigUInt64LE(64n, 40);
  bytes.writeUInt16LE(64, 52);
  bytes.writeUInt16LE(64, 58);
  bytes.writeUInt16LE(4, 60);
  bytes.writeUInt16LE(3, 62);
  const names = Buffer.from("\0.sha256_sig\0.sig_key\0.shstrtab\0");
  names.copy(bytes, 320);
  for (const [index, name, type, offset, size] of [
    [1, 1, 1, signatureOffset, 4096], [2, 13, 1, keyOffset, 4096], [3, 22, 3, 320, names.length]
  ]) {
    const entry = 64 + index * 64;
    bytes.writeUInt32LE(name, entry); bytes.writeUInt32LE(type, entry + 4);
    bytes.writeBigUInt64LE(BigInt(offset), entry + 24); bytes.writeBigUInt64LE(BigInt(size), entry + 32);
  }
  bytes.write(label, payloadOffset);
  return { bytes, signatureOffset, keyOffset, payloadOffset, digest: createHash("sha256").update(bytes).digest("hex") };
}
