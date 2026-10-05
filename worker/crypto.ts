const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey(secret: string) {
  const material = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`hitoma:cookie:v1:${secret}`),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Domain-separated authenticated encryption. No identifier is readable in the cookie. */
export async function seal(
  value: unknown,
  secret: string,
  purpose: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(purpose) },
    await encryptionKey(secret),
    encoder.encode(JSON.stringify(value)),
  );
  return `${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}

export async function unseal<T>(
  value: string | undefined,
  secret: string,
  purpose: string,
): Promise<T | null> {
  if (!value || value.length > 4096) return null;
  try {
    const [iv, ciphertext, extra] = value.split(".");
    if (!iv || !ciphertext || extra !== undefined) return null;
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode(iv),
        additionalData: encoder.encode(purpose),
      },
      await encryptionKey(secret),
      decode(ciphertext),
    );
    return JSON.parse(decoder.decode(plaintext)) as T;
  } catch {
    return null;
  }
}

export async function privateHash(
  secret: string,
  purpose: string,
  value: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`hitoma:${purpose}:${value}`),
  );
  return encode(new Uint8Array(digest));
}

export function cookies(request: Request): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    result[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return result;
}

export function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export const SESSION_COOKIE = "__Host-hitoma-session";
export const CHALLENGE_COOKIE = "__Host-hitoma-challenge";
