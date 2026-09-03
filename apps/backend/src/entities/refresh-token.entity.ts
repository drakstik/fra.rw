import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from "typeorm";
import { User } from "./user.entity.js";

/**
 * Server-side record backing refresh tokens, for any user role.
 *
 * Why this table exists (not just a signed JWT):
 * A short-lived JWT access token (e.g. 15 min) is stateless and can't be
 * revoked before it expires — fine for "access", wrong for "logout" or
 * "I think my account is compromised". So the access token is paired with
 * a long-lived opaque refresh token that IS tracked here, letting
 * `/logout` actually revoke a session instead of just deleting a cookie.
 *
 * Security properties this table is designed to support (implemented in
 * the auth service, not here):
 *  - Only a SHA-256 hash of the refresh token is stored — never the raw
 *    token — so a DB leak alone doesn't hand out valid sessions.
 *  - Rotation: each time a refresh token is used, it's revoked and a new
 *    one is issued, chained via `replacedByTokenHash`.
 *  - Reuse detection: if a token that's already been revoked/replaced is
 *    presented again, that's a strong signal of theft — the service
 *    should revoke the entire `family` (every descendant token) and can
 *    force re-authentication.
 */

@Entity({ name: "refresh_tokens" })
export class RefreshToken {
    @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index("IDX_refresh_tokens_user_id")
  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  // When a user gets deleted, so does its tokens
  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  /** SHA-256 hex digest of the raw refresh token. Never the raw token. */
  @Index("UQ_refresh_tokens_token_hash", { unique: true })
  @Column({ name: "token_hash", type: "char", length: 64 })
  tokenHash!: string;

  /**
   * Groups a chain of rotated tokens together so the whole chain can be
   * revoked at once on reuse detection. Set to this row's own `id` on the
   * first token in a session; copied forward on every rotation.
   */
  @Index("IDX_refresh_tokens_family_id")
  @Column({ name: "family_id", type: "uuid" })
  familyId!: string;

  @Column({ name: "user_agent", type: "varchar", length: 512, nullable: true })
  userAgent!: string | null;

  @Column({ name: "ip_address", type: "inet", nullable: true })
  ipAddress!: string | null;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true, default: null })
  revokedAt!: Date | null;

  /** Hash of the token this one was rotated into, if any. */
  @Column({
    name: "replaced_by_token_hash",
    type: "char",
    length: 64,
    nullable: true,
    default: null,
  })
  replacedByTokenHash!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}