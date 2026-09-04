import { randomBytes, createHash, randomUUID } from "node:crypto";

/**
 * Generates a high-entropy opaque token and its SHA-256 hash. Used for
 * both access and refresh tokens (see AccessSession / RefreshToken
 * entities) — only the hash is ever persisted; the raw value exists only
 * in the cookie on the client and in memory for the single response that
 * issues it. A DB leak alone can't be used to mint sessions, and a
 * captured raw token (in a server log, a browser extension, etc.)
 * carries no information about who it belongs to — it's just a random
 * string until compared against the stored hash.
 */
export function generateOpaqueToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url"); // 256 bits of entropy
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function newFamilyId(): string {
  return randomUUID();
}