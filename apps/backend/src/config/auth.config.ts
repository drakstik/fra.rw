/**
 * Auth-related environment configuration, isolated from data-source.ts so
 * secrets/TTLs/cookie policy live in one obvious place.
 *
 * Fails fast (at boot, not at request time) if required secrets are
 * missing — an auth service that silently falls back to a default JWT
 * secret is a much worse failure mode than a crash on startup.
 */

import { requireEnv } from "../lib/env.js";

export const isProduction = process.env.NODE_ENV === "production";

/**
 * HS256 signing secret for access tokens. Generate with e.g.
 * `openssl rand -base64 48`. Rotate by supporting a `JWT_ACCESS_SECRET_PREV`
 * fallback if you ever need zero-downtime rotation — not implemented yet,
 * intentionally: don't add rotation complexity before you need it.
 */
export const JWT_ACCESS_SECRET = requireEnv("JWT_ACCESS_SECRET");

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_TTL_DAYS = 30;

export const ACCESS_TOKEN_COOKIE = "access_token";
export const REFRESH_TOKEN_COOKIE = "refresh_token";

/**
 * Threshold for the brute-force lockout already modeled on the User
 * entity (`failedLoginAttempts` / `lockedUntil`).
 */
export const MAX_FAILED_LOGIN_ATTEMPTS = 10;
export const LOCKOUT_DURATION_MINUTES = 15;

/**
 * Shared cookie options. `secure: true` in production only — in local dev
 * over plain HTTP, `secure` cookies would silently never be sent, which
 * is a confusing failure mode if you don't gate it on NODE_ENV.
 *
 * `sameSite: "lax"` (not "strict"): payment-processor redirect-back flows
 * are top-level GET navigations from a cross-site context. "strict" would
 * drop the session cookie on that navigation — exactly when the customer
 * returns from checkout. "lax" still blocks the cookie being sent on
 * cross-site POST/fetch, which is what matters for CSRF on state-changing
 * requests.
 */
export function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  };
}