/**
 * Thrown by services when a request should fail with a specific HTTP
 * status + a message that's safe to show a client. Anything that's NOT
 * an AppError is treated by the error handler as an
 * unexpected/internal error and is never shown to the client verbatim —
 * that split is what stops stack traces or DB error text from leaking
 * to the response.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "AppError";
  }
}

export const Errors = {
  invalidCredentials: () =>
    new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password."),
  accountLocked: () =>
    new AppError(423, "ACCOUNT_LOCKED", "Account temporarily locked due to repeated failed logins. Please wait a bit before trying again."),
  accountInactive: () =>
    new AppError(403, "ACCOUNT_INACTIVE", "This account is inactive."),
  emailTaken: () =>
    new AppError(409, "EMAIL_TAKEN", "An account with this email already exists."),
  phoneTaken: () =>
    new AppError(409, "PHONE_TAKEN", "An account with this phone number already exists."),
  unauthenticated: () =>
    new AppError(401, "UNAUTHENTICATED", "Authentication required."),
  invalidRefreshToken: () =>
    new AppError(401, "INVALID_REFRESH_TOKEN", "Session expired or invalid. Please log in again."),
};