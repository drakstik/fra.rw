import rateLimit from "express-rate-limit";

/**
 * Per-IP limits on the auth endpoints, independent of the per-account
 * lockout already modeled on User (failedLoginAttempts/lockedUntil).
 * The two are complementary: the DB lockout stops someone hammering ONE
 * account from many IPs; this stops one IP hammering MANY accounts
 * (credential stuffing) or spamming sign-ups.
 *
 * Relies on Express's `trust proxy` setting (added in index.ts later)
 * to read the real client IP from X-Forwarded-For, since nginx sits in
 * front on the single host.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later." } },
});

export const signUpRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later." } },
});

export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later." } },
});