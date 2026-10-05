import { computeRpSignatureMessage } from "@worldcoin/idkit-core/signing";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { etc, sign, utils } from "@noble/secp256k1";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { keccak_256 } from "@noble/hashes/sha3";

// The SDK signRequest() is Node-only and lazily computes the curve table.
// Prepare the public base-point table at Worker startup (no key or randomness),
// so the first request avoids this work under the Workers Free 10 ms CPU budget.
// Message serialization and hash-to-field stay in the official SDK.
etc.hmacSha256Sync = (key, ...messages) =>
  hmac(sha256, key, etc.concatBytes(...messages));
utils.precompute(8);

export function signSessionRequest(signingKeyHex: string, now: number) {
  const nonce = hashSignal(crypto.getRandomValues(new Uint8Array(32)));
  const createdAt = now;
  const expiresAt = now + 300;
  const message = computeRpSignatureMessage(
    etc.hexToBytes(nonce.slice(2)),
    createdAt,
    expiresAt,
  );
  const prefix = new TextEncoder().encode(
    `\x19Ethereum Signed Message:\n${message.length}`,
  );
  const digest = keccak_256(etc.concatBytes(prefix, message));
  const signed = sign(digest, etc.hexToBytes(signingKeyHex.replace(/^0x/, "")));
  const signature = new Uint8Array(65);
  signature.set(signed.toCompactRawBytes());
  signature[64] = signed.recovery + 27;
  return { sig: `0x${etc.bytesToHex(signature)}`, nonce, createdAt, expiresAt };
}
