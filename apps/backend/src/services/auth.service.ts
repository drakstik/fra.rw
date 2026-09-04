import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { AppDataSource } from "../config/data-source.js";
import { User } from "../entities/user.entity.js";
import { CustomerUser } from "../entities/customer-user.entity.js";
import { RefreshToken } from "../entities/refresh-token.entity.js";
import { generateOpaqueToken, hashToken, newFamilyId } from "../lib/tokens.js";
import { AccessSession } from "../entities/access-session.entity.js";
import { AppError, Errors } from "../lib/errors.js";
import { UserRole } from "../entities/enums/user-role.enum.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  LOCKOUT_DURATION_MINUTES,
  MAX_FAILED_LOGIN_ATTEMPTS,
  REFRESH_TOKEN_TTL_DAYS,
} from "../config/auth.config.js";

// @node-rs/argon2 exports `Algorithm` as a TS `const enum`, which is
// incompatible with this project's `verbatimModuleSyntax` tsconfig
// setting. Argon2id = 2 in that enum — pinned here as a plain constant
// instead of importing the enum. (Argon2id is the OWASP-recommended
// variant: resistant to both GPU-cracking and side-channel attacks.)
const ARGON2ID = 2;

const userRepo = () => AppDataSource.getRepository(User);
const customerRepo = () => AppDataSource.getRepository(CustomerUser);
const refreshRepo = () => AppDataSource.getRepository(RefreshToken);
const accessSessionRepo = () => AppDataSource.getRepository(AccessSession);

export interface SignUpInput {
  email: string;
  phoneNumber: string;
  firstName: string;
  lastName: string;
  password: string;
}

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string; // raw value — caller puts this in a cookie, never logs it
  refreshTokenExpiresAt: Date;
}

/** Strip fields that must never leave the server (passwordHash, etc). */
export function toPublicUser(user: User) {
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    phoneNumber: user.phoneNumber,
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

/**
 * Issues a fresh access session + a brand-new refresh token family. Used
 * at sign-up and at login (i.e. whenever this is a NEW session, not a
 * rotation of an existing one).
 *
 * Both rows share one `familyId`. That's the link that makes reuse
 * detection on /auth/refresh able to kill a live access session
 * immediately, not just the refresh chain — see the design discussion
 * this came out of.
 *
 * Wrapped in a transaction: the two inserts (refresh row, access row)
 * must succeed or fail together. Without this, a crash between the two
 * writes could leave a refresh token with no matching access session —
 * not a security hole (the session would just be unusable, forcing a
 * fresh login), but an inconsistent row we don't want sitting in the DB.
 */
async function issueNewSession(user: User, meta: RequestMeta): Promise<TokenPair> {
  const familyId = newFamilyId();

  const refresh = generateOpaqueToken();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const access = generateOpaqueToken();
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);

  await AppDataSource.transaction(async (manager) => {
    const refreshRow = manager.create(RefreshToken, {
      userId: user.id,
      tokenHash: refresh.hash,
      familyId,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      expiresAt: refreshExpiresAt,
    });
    await manager.save(refreshRow);

    const accessRow = manager.create(AccessSession, {
      userId: user.id,
      tokenHash: access.hash,
      familyId,
      expiresAt: accessExpiresAt,
    });
    await manager.save(accessRow);
  });

  return {
    accessToken: access.raw,
    refreshToken: refresh.raw,
    refreshTokenExpiresAt: refreshExpiresAt,
  };
}

export async function signUpCustomer(input: SignUpInput, meta: RequestMeta) {
  // Pre-check for a friendlier error than a raw unique-constraint violation.
  // The DB's partial unique indexes (WHERE deleted_at IS NULL) remain the
  // actual source of truth/race-condition backstop — this is just UX.
  const existingEmail = await userRepo().findOne({ where: { email: input.email } });
  if (existingEmail) throw Errors.emailTaken();
  const existingPhone = await userRepo().findOne({ where: { phoneNumber: input.phoneNumber } });
  if (existingPhone) throw Errors.phoneTaken();

  const passwordHash = await argon2Hash(input.password, { algorithm: ARGON2ID });

  const customer = customerRepo().create({
    email: input.email,
    phoneNumber: input.phoneNumber,
    firstName: input.firstName,
    lastName: input.lastName,
    passwordHash,
    role: UserRole.CUSTOMER,
  });

  try {
    await customerRepo().save(customer);
  } catch (err: unknown) {
    // Race condition backstop: two sign-ups for the same email landed
    // between the pre-check and the insert. Postgres unique_violation = 23505.
    if (isUniqueViolation(err)) throw Errors.emailTaken();
    throw err;
  }

  const tokens = await issueNewSession(customer, meta);
  return { user: toPublicUser(customer), tokens };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export async function loginCustomer(email: string, password: string, meta: RequestMeta) {
  const user = await userRepo()
    .createQueryBuilder("user")
    .addSelect("user.passwordHash") // excluded by default (select: false on entity)
    .where("user.email = :email", { email })
    .getOne();

  // Constant-shape response whether the account exists or not — do not
  // let a timing/response difference reveal whether an email is registered.
  if (!user) {
    await argon2Hash(password, { algorithm: ARGON2ID }).catch(() => undefined); // burn ~same time as a real check
    throw Errors.invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw Errors.accountLocked();
  }
  if (!user.isActive) {
    throw Errors.accountInactive();
  }

  const passwordOk = await argon2Verify(user.passwordHash, password);

  if (!passwordOk) {
    await registerFailedLogin(user);
    throw Errors.invalidCredentials();
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  await userRepo().save(user);

  const tokens = await issueNewSession(user, meta);
  return { user: toPublicUser(user), tokens };
}

async function registerFailedLogin(user: User): Promise<void> {
  user.failedLoginAttempts += 1;
  if (user.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
    user.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000);
  }
  await userRepo().save(user);
}

/**
 * Revokes an entire session: the refresh chain (marked revoked, kept for
 * audit) and the access session (hard-deleted — see AccessSession's
 * class comment on why it has no revokedAt column). Since every login
 * mints its own unique familyId, this both serves reuse-detection (kill
 * a suspected-stolen session) and ordinary logout (end this one session)
 * — same operation, different caller.
 */
export async function revokeFamily(familyId: string): Promise<void> {
  await refreshRepo()
    .createQueryBuilder()
    .update(RefreshToken)
    .set({ revokedAt: new Date() })
    .where("family_id = :familyId", { familyId })
    .andWhere("revoked_at IS NULL")
    .execute();

  await accessSessionRepo()
    .createQueryBuilder()
    .delete()
    .from(AccessSession)
    .where("family_id = :familyId", { familyId })
    .execute();
}

/**
 * Rotates a refresh token: the presented token is revoked and a new one
 * is issued in the same family, along with a fresh access session. If
 * the presented token is found but was ALREADY revoked (or has expired),
 * that's treated as a signal of possible theft — the entire family is
 * revoked, forcing re-authentication rather than silently failing just
 * this one request.
 */
export async function rotateRefreshToken(rawToken: string, meta: RequestMeta): Promise<TokenPair> {
  const hash = hashToken(rawToken);
  const tokenRow = await refreshRepo().findOne({ where: { tokenHash: hash } });

  if (!tokenRow) throw Errors.invalidRefreshToken();

  if (tokenRow.revokedAt || tokenRow.expiresAt < new Date()) { // if true then token may be stolen
    await revokeFamily(tokenRow.familyId); // Revoke entire family
    throw Errors.invalidRefreshToken(); // Return error to client
  }

  const user = await userRepo().findOne({ where: { id: tokenRow.userId } });
  if (!user || !user.isActive) throw Errors.invalidRefreshToken();

  // Generate new token
  const refresh = generateOpaqueToken(); 
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const access = generateOpaqueToken();
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);

  await AppDataSource.transaction(async (manager) => {
    tokenRow.revokedAt = new Date();
    tokenRow.replacedByTokenHash = refresh.hash;
    await manager.save(tokenRow);

    const newRefreshRow = manager.create(RefreshToken, {
      userId: user.id,
      tokenHash: refresh.hash,
      familyId: tokenRow.familyId,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      expiresAt: refreshExpiresAt,
    });
    await manager.save(newRefreshRow);

    // Strict revocation: kill every existing access session for this
    // family before minting the replacement, rather than letting the
    // superseded one linger until its own TTL expires. Trades a small
    // amount of leniency (a request already in flight during rotation
    // could momentarily see its access session gone) for tighter
    // "rotation == immediate revocation of the old session."
    await manager.delete(AccessSession, { familyId: tokenRow.familyId });

    const newAccessRow = manager.create(AccessSession, {
      userId: user.id,
      tokenHash: access.hash,
      familyId: tokenRow.familyId,
      expiresAt: accessExpiresAt,
    });
    await manager.save(newAccessRow);
  });

  return { accessToken: access.raw, refreshToken: refresh.raw, refreshTokenExpiresAt: refreshExpiresAt };
}

export async function logout(rawToken: string): Promise<void> {
  const hash = hashToken(rawToken);
  const tokenRow = await refreshRepo().findOne({ where: { tokenHash: hash } });
  if (tokenRow) await revokeFamily(tokenRow.familyId);
}

export async function getUserById(id: string): Promise<User | null> {
  return userRepo().findOne({ where: { id } });
}