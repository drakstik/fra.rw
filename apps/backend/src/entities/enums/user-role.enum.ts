/**
 * The three account roles in the system.
 *
 * This also doubles as the Single Table Inheritance discriminator value
 * stored in `users.role` (see `TableInheritance` on `User`), so the string
 * values below are persisted in the database — do not rename them without
 * a migration.
 */
export enum UserRole {
  ADMIN = "admin",
  CUSTOMER = "customer",
  OPERATOR = "operator",
}
