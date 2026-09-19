/**
 * Hand-written OpenAPI spec for Swagger UI (see index.ts — mounted at
 * /docs, dev-only). Kept as a plain TS object instead of generating it
 * from the zod schemas: the schemas describe request *shape*, not the
 * cookie-setting side effects, rate limits, or multi-server story this
 * doc exists to make visible.
 *
 * IMPORTANT: the "servers" list is the whole point of this file. Pick
 * the "Via nginx" server before clicking "Try it out" on /refresh or
 * /logout — that's the only server that reproduces the real browser
 * topology (see REFRESH_TOKEN_COOKIE_PATH in auth.config.ts). Hitting
 * the backend directly on :3000 will make refresh/logout LOOK broken
 * (no cookie sent) even though sign-up/login/me work fine either way —
 * that's expected, not a bug, and is exactly the gap this doc exists to
 * make obvious instead of silently confusing.
 */
export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "fra.rw auth API",
    version: "0.1.0",
    description:
      "Customer auth: sign-up, login, refresh rotation, logout, /me. " +
      "Dev-only doc — not mounted when NODE_ENV=production (see index.ts).",
  },
  servers: [
    { url: "/api", description: "Via nginx (matches production topology — use this one)" },
    {
      url: "http://localhost:3000",
      description: "Direct to backend, bypassing nginx (refresh/logout cookies will NOT work here — see note above)",
    },
  ],
  components: {
    securitySchemes: {
      accessTokenCookie: {
        type: "apiKey",
        in: "cookie",
        name: "access_token",
        description: "Set automatically by sign-up/login/refresh. Swagger UI sends cookies automatically on same-origin requests.",
      },
    },
    schemas: {
      SignUpRequest: {
        type: "object",
        required: ["email", "phoneNumber", "firstName", "lastName", "password"],
        properties: {
          email: { type: "string", format: "email", example: "a@x.com" },
          phoneNumber: { type: "string", example: "+250788000001" },
          firstName: { type: "string", example: "A" },
          lastName: { type: "string", example: "B" },
          password: { type: "string", minLength: 12, example: "correcthorsebattery" },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
        },
      },
      UserPublic: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          role: { type: "string", example: "customer" },
          email: { type: "string" },
          phoneNumber: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
        },
      },
      ErrorResponse: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string", example: "ACCOUNT_EXISTS" },
              message: { type: "string" },
            },
          },
        },
      },
    },
  },
  paths: {
    "/auth/sign-up": {
      post: {
        summary: "Create a customer account",
        description: "Rate-limited. On success, sets access_token and refresh_token cookies (see the servers note above).",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/SignUpRequest" } } },
        },
        responses: {
          "201": {
            description: "Account created",
            content: {
              "application/json": {
                schema: { type: "object", properties: { user: { $ref: "#/components/schemas/UserPublic" } } },
              },
            },
          },
          "409": {
            description:
              "ACCOUNT_EXISTS — deliberately generic: does not reveal whether the email or the phone number collided (see CLAUDE.md security notes on sign-up enumeration).",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
          },
          "429": { description: "Too many sign-up attempts from this IP" },
        },
      },
    },
    "/auth/login": {
      post: {
        summary: "Log in with email + password",
        description: "Rate-limited; locks the account after repeated failures (see MAX_FAILED_LOGIN_ATTEMPTS).",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } } },
        },
        responses: {
          "200": {
            description: "Logged in — sets access_token and refresh_token cookies",
            content: {
              "application/json": {
                schema: { type: "object", properties: { user: { $ref: "#/components/schemas/UserPublic" } } },
              },
            },
          },
          "401": { description: "Wrong email or password" },
          "423": { description: "Account temporarily locked" },
        },
      },
    },
    "/auth/refresh": {
      post: {
        summary: "Rotate the refresh token",
        description:
          "Reads the refresh_token cookie, issues a new access+refresh pair. Replaying an already-used or expired " +
          "refresh token revokes the ENTIRE token family (theft-detection) — use this to verify that behavior, not " +
          "just the happy path. Requires the refresh_token cookie to actually reach the server: use the " +
          "'Via nginx' server.",
        responses: {
          "200": { description: "Rotated — new cookies set" },
          "401": { description: "INVALID_REFRESH_TOKEN — missing, expired, already-used, or family was revoked" },
        },
      },
    },
    "/auth/logout": {
      post: {
        summary: "Revoke the current refresh token and clear cookies",
        responses: { "204": { description: "Logged out" } },
      },
    },
    "/auth/me": {
      get: {
        summary: "Get the current authenticated user",
        security: [{ accessTokenCookie: [] }],
        responses: {
          "200": {
            description: "Current user",
            content: {
              "application/json": {
                schema: { type: "object", properties: { user: { $ref: "#/components/schemas/UserPublic" } } },
              },
            },
          },
          "401": { description: "Not authenticated / access token missing or expired" },
        },
      },
    },
  },
};