import {
  Entity,
  TableInheritance,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from "typeorm";
import { UserRole } from "./enums/user-role.enum.js";

/**
 * Base `users` table, shared by all three account types (admin, customer,
 * operator) via TypeORM's Single Table Inheritance (STI).
 *
 * Why STI instead of three separate tables:
 *  - The uniqueness rule ("an email/phone number can only ever belong to
 *    one account, regardless of role") is trivial to enforce with a single
 *    table + a single unique index. Three tables would need an extra
 *    cross-table check (e.g. a shared "identities" table) to get the same
 *    guarantee.
 *  - Auth code (login, JWT validation, "/me") operates on "a user" without
 *    caring about role most of the time; STI lets that code query one
 *    table and branch on `role` only where it actually matters.
 *
 * This class is never instantiated directly — always use one of the child
 * entities (`CustomerUser` now; `AdminUser` / `OperatorUser` once the
 * invitation flow is built).
 *
 * Rows are soft-deleted (`deletedAt`) rather than hard-deleted so that
 * order history / audit trails referencing a user survive account closure.
 * Because of that, uniqueness on email/phone is enforced with a *partial*
 * index (`WHERE deleted_at IS NULL`) so a closed account's email can be
 * reused by a new sign-up.
 */

@Entity({ name: "users" })
@TableInheritance({ column: { type: "varchar", name: "role" } })
@Index("UQ_users_email_active", ["email"], {
  unique: true, // Email is unique
  where: '"deleted_at" IS NULL', // Email must not be soft deleted
})
@Index("UQ_users_phone_number_active", ["phoneNumber"], {
  unique: true, // phone numbers must be unique
  where: '"deleted_at" IS NULL', // Email must not be soft deleted
})

export abstract class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;
   /**
   * STI discriminator column. `@TableInheritance` above already tells
   * TypeORM which DB column ("role") and type back this discriminator —
   * this @Column mapping is what makes that same value actually hydrate
   * onto this property when an entity is loaded, rather than staying
   * internal to TypeORM's own subclass-selection logic.
   *
   * insert: false / update: false (the current replacement for the
   * removed `readonly` column option, per TypeORM 1.0's migration guide)
   * — the value is written by TypeORM's own STI mechanism based on which
   * `@ChildEntity(...)` subclass is being saved, not by application code
   * setting this property directly.
   */
  @Column({ type: "varchar", name: "role", update: false })
  readonly role!: UserRole;

  /**
   * Stored as `citext` so equality/uniqueness is case-insensitive
   * ("Jane@Example.com" and "jane@example.com" are the same account)
   * while the originally-typed casing is preserved for display.
   */
  @Column({ type: "citext" })
  email!: string;

  /**
   * Normalized to E.164 (e.g. "+250788123456") by the service layer before
   * save. The CHECK constraint below is a defense-in-depth backstop, not a
   * substitute for proper validation/normalization on the way in.
   */
  @Column({ name: "phone_number", type: "varchar", length: 20 })
  phoneNumber!: string;

  @Column({ name: "first_name", type: "varchar", length: 100 })
  firstName!: string;

  @Column({ name: "last_name", type: "varchar", length: 100 })
  lastName!: string;

  /**
   * Argon2id hash of the password. `select: false` so it is never
   * returned by default `find`/`findOne` queries — callers that actually
   * need it (login) must opt in with `.addSelect("user.passwordHash")`.
   * Never store or log the plaintext password anywhere.
   */
  @Column({ name: "password_hash", type: "varchar", select: false })
  passwordHash!: string;

  /**
   * Bumped whenever all outstanding sessions for this user should be
   * invalidated at once (password change, logout-everywhere, suspected
   * compromise). The JWT's `tokenVersion` claim is checked against this
   * column on every authenticated request.
   */
  @Column({ name: "token_version", type: "int", default: 0 })
  tokenVersion!: number;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @Column({
    name: "email_verified_at",
    type: "timestamptz",
    nullable: true,
    default: null,
  })
  emailVerifiedAt!: Date | null;

  /**
   * Brute-force login protection: incremented on each failed password
   * check by the auth service and reset to 0 on success. When it crosses
   * a threshold the service sets `lockedUntil` instead of continuing to
   * check passwords, to slow down credential-stuffing attempts.
   */
  @Column({ name: "failed_login_attempts", type: "int", default: 0 })
  failedLoginAttempts!: number;

  @Column({
    name: "locked_until",
    type: "timestamptz",
    nullable: true,
    default: null,
  })
  lockedUntil!: Date | null;

  @Column({
    name: "last_login_at",
    type: "timestamptz",
    nullable: true,
    default: null,
  })
  lastLoginAt!: Date | null;

  @Column({
    name: "password_changed_at",
    type: "timestamptz",
    nullable: true,
    default: null,
  })
  passwordChangedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;
}