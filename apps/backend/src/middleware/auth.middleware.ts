import type { NextFunction, Request, Response } from "express";
import { AppDataSource } from "../config/data-source.js";
import { AccessSession } from "../entities/access-session.entity.js";
import { hashToken } from "../lib/tokens.js";
import { ACCESS_TOKEN_COOKIE } from "../config/auth.config.js";
import { Errors } from "../lib/errors.js";
import { getUserById } from "../services/auth.service.js";

export interface AuthenticatedUser {
  id: string;
  role: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const accessSessionRepo = () => AppDataSource.getRepository(AccessSession);

/**
 * Verifies the access token against the DB (see the Option C design
 * discussion — access tokens are opaque, not JWTs) and attaches the
 * user's id/role to req.user. Unlike the JWT version this replaced,
 * this DOES hit the database on every authenticated request — that's
 * the deliberate trade-off: revocation is now instant (delete the row,
 * the very next request fails) instead of bounded by a token's TTL.
 *
 * Express 5 auto-forwards rejected promises from async middleware to
 * the error handler, so an unexpected DB error here doesn't need an
 * explicit try/catch — it'll reach errorHandler.ts on its own.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined;
  if (!token) return next(Errors.unauthenticated());

  const hash = hashToken(token);
  const session = await accessSessionRepo().findOne({ where: { tokenHash: hash } });

  if (!session || session.expiresAt < new Date()) {
    return next(Errors.unauthenticated());
  }

  const user = await getUserById(session.userId);
  if (!user || !user.isActive) {
    return next(Errors.unauthenticated());
  }

  req.user = { id: user.id, role: user.role };
  next();
}