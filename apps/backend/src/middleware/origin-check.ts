/**
 * Defense-in-depth CSRF check for state-changing requests.
 *
 * `sameSite: "lax"` on the session cookies is the primary defense: it
 * already stops the browser attaching them to a cross-site POST. This
 * adds a second, independent check for the cases Lax doesn't cover —
 * older/odd browsers, and anything that would make a cross-site request
 * look same-site — by asking the browser where the request came from.
 *
 * Policy:
 *  - Safe methods (GET/HEAD/OPTIONS) are never blocked. They shouldn't
 *    change state; blocking them would break normal top-level navigation
 *    and the payment-processor redirect-back flow `lax` was chosen for.
 *  - `Origin` is checked first, `Referer` only as a fallback (some
 *    browsers omit Origin on same-origin form posts, and Referer can be
 *    stripped by privacy settings, but when present it still carries the
 *    origin).
 *  - Neither header present -> allowed. Browsers ALWAYS send Origin on a
 *    cross-site POST/fetch, so a request with neither cannot be the
 *    cross-site browser request this guards against; it's curl, a health
 *    check, or a future server-to-server webhook (e.g. a payment
 *    callback), and rejecting those would break them for no gain.
 *  - Anything that IS present must parse to an allow-listed origin.
 *    `Origin: null` (sandboxed iframe, some redirect chains) fails to
 *    parse and is therefore blocked, which is what we want.
 *
 * Mounted before the routers, so a blocked request never reaches the
 * handlers and never spends the caller's rate-limit budget.
 */

import type { NextFunction, Request, Response } from "express";
import { ALLOWED_ORIGINS } from "../config/auth.config.js";
import { Errors } from "../lib/errors.js";
import { logSecurityEvent } from "../lib/security-log.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireTrustedOrigin(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get("origin");
  const referer = req.get("referer");
  const claimed = origin ?? referer;
  if (!claimed) return next(); // not a browser; see policy note above

  if (!isAllowedOrigin(claimed)) {
    logSecurityEvent("cross_origin_request_blocked", {
      method: req.method,
      path: req.path,
      origin: origin ?? null,
      referer: referer ?? null,
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
    return next(Errors.crossOriginBlocked());
  }

  next();
}

/**
 * Exact match on the parsed origin (scheme + host + port), never a
 * substring or suffix test: "http://localhost:8080.evil.com" and
 * "https://localhost:8080" must both fail.
 */
function isAllowedOrigin(value: string): boolean {
  try {
    return ALLOWED_ORIGINS.has(new URL(value).origin);
  } catch {
    return false; // unparseable, including the literal "null"
  }
}