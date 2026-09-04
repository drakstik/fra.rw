import { Router } from "express";
import type { Request, Response } from "express";
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_TTL_DAYS,
  baseCookieOptions,
} from "../config/auth.config.js";
import {
  loginCustomer,
  logout,
  rotateRefreshToken,
  signUpCustomer,
  toPublicUser,
  getUserById,
  type RequestMeta,
} from "../services/auth.service.js";
import { validateBody } from "../validation/validate.js";
import { loginSchema, signUpSchema } from "../validation/auth.schemas.js";
import { loginRateLimiter, refreshRateLimiter, signUpRateLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { AppError, Errors } from "../lib/errors.js";

export const authRouter: Router = Router();

function requestMeta(req: Request): RequestMeta {
  return {
    // req.ip resolves via Express's "trust proxy" setting (added in
    // index.ts next), reading X-Forwarded-For as set by nginx.
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

function setSessionCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; refreshTokenExpiresAt: Date },
) {
  const base = baseCookieOptions();
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...base,
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...base,
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    // Refresh token is only needed by /auth/refresh and /auth/logout —
    // scoping the cookie's path to /auth narrows where the browser sends
    // it (never on e.g. /products or /articles requests) without being
    // so narrow it misses the logout endpoint.
    path: "/auth",
  });
}

function clearSessionCookies(res: Response) {
  const base = baseCookieOptions();
  res.clearCookie(ACCESS_TOKEN_COOKIE, base);
  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...base, path: "/auth" });
}

authRouter.post("/sign-up", signUpRateLimiter, validateBody(signUpSchema), async (req, res, next) => {
  try {
    const { user, tokens } = await signUpCustomer(req.body, requestMeta(req));
    setSessionCookies(res, tokens);
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", loginRateLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const { user, tokens } = await loginCustomer(email, password, requestMeta(req));
    setSessionCookies(res, tokens);
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/refresh", refreshRateLimiter, async (req, res, next) => {
  try {
    const rawToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    if (!rawToken) throw Errors.invalidRefreshToken();

    const tokens = await rotateRefreshToken(rawToken, requestMeta(req));
    setSessionCookies(res, tokens);
    res.status(200).json({ ok: true });
  } catch (err) {
    // Reuse/expiry detection revokes the family — make sure the client's
    // stale cookies are cleared too, not just rejected.
    if (err instanceof AppError && err.code === "INVALID_REFRESH_TOKEN") {
      clearSessionCookies(res);
    }
    next(err);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const rawToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    if (rawToken) await logout(rawToken);
    clearSessionCookies(res);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await getUserById(req.user!.id);
    if (!user || !user.isActive) throw Errors.unauthenticated();
    res.status(200).json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});