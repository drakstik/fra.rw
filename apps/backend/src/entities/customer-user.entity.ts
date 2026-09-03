import { ChildEntity } from "typeorm";
import { User } from "./user.entity.js";
import { UserRole } from "./enums/user-role.enum.js";

/**
 * A self-registered customer account — the only role created through the
 * public `/sign-up` endpoint. Admin and operator accounts are provisioned
 * by invitation instead (separate `AdminUser` / `OperatorUser` child
 * entities + an invite-token flow, to be added alongside their endpoints).
 *
 * No customer-specific columns yet. When they're needed (e.g. shipping
 * addresses, marketing consent, loyalty points), add them here — they'll
 * live in the same `users` table as nullable columns, unused by the other
 * two roles, which is the standard trade-off of STI. If customer-specific
 * data grows large/relational, prefer a separate `customer_profiles` table
 * with a one-to-one relation instead of piling more columns onto `users`.
 */
@ChildEntity(UserRole.CUSTOMER)
export class CustomerUser extends User {}
