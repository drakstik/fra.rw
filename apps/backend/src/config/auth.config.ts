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

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_TTL_DAYS = 30;

export const ACCESS_TOKEN_COOKIE = "access_token";
export const REFRESH_TOKEN_COOKIE = "refresh_token";

/**
 * Path scope for the refresh-token cookie, in THIS SERVICE's own route
 * space (matches index.ts's `app.use("/auth", authRouter)`).
 *
 * Deliberately NOT "/api/auth" — this app doesn't know or care that
 * nginx happens to expose it under an /api/ prefix externally (see
 * apps/frontend/nginx.conf). nginx already owns that prefix mapping for
 * request paths via `proxy_pass`; it also owns the equivalent mapping
 * for the outgoing Set-Cookie Path via `proxy_cookie_path /auth
 * /api/auth;`. Keeping the proxy topology out of the app is why this is
 * "/auth", not something env-configurable pointing at a specific
 * deployment's external URL shape.
 */
export const REFRESH_TOKEN_COOKIE_PATH = "/auth";

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