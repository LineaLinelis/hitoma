import { afterEach, expect, it, vi } from "vitest";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { signSessionRequest } from "../worker/signing";

afterEach(() => vi.restoreAllMocks());

it("Workers用署名が、同じ乱数と時刻の公式SDK署名にバイト単位で一致する", () => {
  const key = `0x${"1".repeat(64)}`;
  const now = 1791180000;
  vi.spyOn(Date, "now").mockReturnValue(now * 1000);
  // Fixed entropy only inside this equivalence test. Production uses Web Crypto.
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    (array as Uint8Array).set(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
    return array;
  });
  expect(signSessionRequest(key, now)).toEqual(
    signRequest({ signingKeyHex: key, ttl: 300 }),
  );
});
