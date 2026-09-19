import { z } from "zod";

// Basic E.164 check: "+" then 8-15 digits. The service layer is the
// source of truth for uniqueness; this just rejects obviously malformed
// input before it reaches the DB. Swap for libphonenumber-js if you need
// real per-country validation later.
const phoneNumber = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Phone number must be in E.164 format, e.g. +250788123456");

// NIST 800-63B guidance: prioritize length over forced complexity rules
// (no mandatory "1 uppercase, 1 symbol" theatre — those push users
// toward predictable patterns). 12 chars minimum, capped to stop
// deliberately huge inputs from being used for hashing-cost DoS.
const password = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(256, "Password is too long.");

export const signUpSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  phoneNumber,
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  password,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(256),
});