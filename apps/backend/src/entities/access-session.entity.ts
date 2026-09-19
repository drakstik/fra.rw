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
 * Server-side record backing access tokens. This trades a
 * DB read per request for two real properties a signed-but-unencrypted
 * JWT can't give us: the token's contents are never exposed to anything
 * that captures the raw value (server logs, a compromised browser
 * extension, a TLS-terminating intermediary), and revocation is
 * immediate rather than bounded by a token's remaining TTL.
 *
 * `familyId` deliberately matches the `family_id` of the sibling
 * RefreshToken issued alongside this access session. This is what lets
 * reuse-detection on /auth/refresh (see auth.service.ts) kill a live
 * access session the instant token theft is detected, rather than
 * leaving it valid until it naturally expires.
 *
 * Rows are hard-deleted (on logout, on rotation, or by a periodic sweep
 * of expired rows) rather than soft-deleted like RefreshToken — there's
 * no reuse-detection or audit need for access sessions individually,
 * they're just short-lived bearer credentials.
 */
@Entity({ name: "access_sessions" })
export class AccessSession {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index("IDX_access_sessions_user_id")
  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  /** SHA-256 hex digest of the raw access token. Never the raw value. */
  @Index("UQ_access_sessions_token_hash", { unique: true })
  @Column({ name: "token_hash", type: "char", length: 64 })
  tokenHash!: string;

  /** Matches the sibling RefreshToken's family_id — see class comment. */
  @Index("IDX_access_sessions_family_id")
  @Column({ name: "family_id", type: "uuid" })
  familyId!: string;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}