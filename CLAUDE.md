# CLAUDE.md — fra.rw project context

This file exists to bring a new AI agent session up to speed quickly. It covers what's been built, why specific decisions were made, what's verified vs. not, and what to do next. Read this before touching the codebase.

**This version was checked directly against the actual `feat/customer-auth` branch as pushed to GitHub** (not written from memory of the working session) — the previous draft of this file was pushed empty (0 bytes) and also contained an inaccuracy about frontend progress, corrected below.

## Project basics

- **Stack**: pnpm workspace monorepo. `apps/backend` — Node.js 22, TypeScript (strict, `verbatimModuleSyntax`, `nodenext` modules — relative imports need explicit `.js` extensions), Express 5, TypeORM 1.x (see below — **not the more commonly-referenced 0.3.x line**) against PostgreSQL 16. `apps/frontend` — Svelte 5 + Vite.
- **Infra target**: single-host cloud instance, Docker Compose, nginx in front (TLS termination planned there, not yet implemented). `docker-compose.yml` (root) is the production config; `.devcontainer/docker-compose.extend.yml` overrides the `backend` service for local dev only (`backend-dev` build target, bind-mounted source, hot reload via `tsx watch`).
- **Dev environment**: VS Code Dev Containers, project lives in an AlmaLinux 9.7 WSL2 instance on the developer's laptop. `curl` is installed in the `backend-dev` Dockerfile stage only (dev convenience) — confirmed via `docker build --target backend` that it never reaches the production image.
- **Payments (planned, not built)**: IremboPay or a similar regional processor, via hosted checkout (keeps card data off this server — SAQ-A PCI scope, not SAQ-D).
- **Current branch**: `feat/customer-auth`, pushed to GitHub, **not yet merged to `main`** (confirmed by diffing the two branches directly — `main` has none of the auth work).

## ⚠️ TypeORM is on v1.x, not v0.3.x

`apps/backend/package.json` resolves `typeorm@^1.1.0`. TypeORM hit a genuine 1.0 release on 2026-05-19 — this is **not** a typosquat or supply-chain issue (verified against typeorm.io's own release notes and blog during this project). But it means:
- Training data / general knowledge about TypeORM likely reflects 0.3.x behavior and APIs. Don't assume something described online or from memory still applies — check `typeorm.io` (current docs default to 1.x; 0.3.x docs are at `v0.typeorm.io`) or the installed package's own `.d.ts` files before relying on an API.
- A real behavioral gap was found and fixed during this project (see "Bugs found and fixed" below) related to `@TableInheritance` discriminator columns not auto-populating onto undecorated class properties. Don't assume other STI-adjacent behavior works the way older TypeORM tutorials describe.

## Security architecture — decisions and why

These were deliberated, not defaults. Don't casually change them without understanding the trade-off that was already considered.

- **Access tokens are opaque, DB-backed, not JWTs** ("Option C" in project discussion). Rejected a signed JWT (JWS) approach specifically because JWT payloads are signed but not encrypted — readable by anything that captures the raw token (server logs, a compromised browser extension, a TLS-terminating intermediary like a future CDN). Opaque tokens carry zero information if captured. Trade-off accepted: a DB read on every authenticated request — judged acceptable at the stated scale (~1000 concurrent users), reconsider if that changes by orders of magnitude.
- **Redis was considered and rejected** for session storage, on security grounds specifically: it's a new network-facing service with its own real-world breach history (unauthenticated/exposed Redis is a commonly exploited misconfiguration), while a Postgres table adds zero new attack surface to an already-trusted, already-isolated service. Revisit if the project ever needs multiple backend instances (also see the rate-limiter note below) — that's the point at which Redis's trade-offs start actually paying for themselves.
- **Refresh token rotation + reuse detection**: implemented and **live-tested** (replaying an already-rotated refresh token correctly revokes the entire session family, including the paired access session). `access_sessions` and `refresh_tokens` rows sharing one `familyId` is what makes theft-detection kill *both* token types instantly, not just the refresh chain.
- **Argon2id via `@node-rs/argon2`, not the `argon2` package.** The repo's `.npmrc` has `ignore-scripts=true` (a deliberate, good supply-chain hardening default). The plain `argon2` package needs a postinstall script to build its native binding and would silently break under that setting. `@node-rs/argon2` ships prebuilt bindings with no install script needed.
- **Password policy**: 12-char minimum, no forced complexity rules (NIST 800-63B guidance — length over "1 uppercase, 1 symbol" theatre), 256-char cap (prevents oversized input being used for Argon2 hashing-cost DoS).
- **Cookies**: `HttpOnly`, `Secure` (prod only, gated on `NODE_ENV`), `SameSite=Lax` — deliberately not `Strict`, because a payment-processor redirect-back is a top-level cross-site GET navigation that `Strict` would drop the session cookie on. Refresh token cookie scoped to `path: "/auth"` (covers both `/auth/refresh` and `/auth/logout` — an earlier draft scoped it to `/auth/refresh` only and broke logout; fixed before it shipped).
- **Login timing**: a nonexistent-email login burns a throwaway Argon2 hash to keep response time roughly constant vs. a real account — mitigates email-enumeration via timing.
- **Rate limiting**: per-IP limits on `/sign-up`, `/login`, `/refresh`, layered on top of the existing per-account DB lockout (`failedLoginAttempts`/`lockedUntil` on `User`, verified live — 10 failed attempts locks the account for 15 min, confirmed the *correct* password is also rejected while locked).
- **`express-rate-limit`'s default in-memory store only works for a single backend process.** Not an issue at current single-instance scale, but flagged as a known gap: if the project ever runs multiple backend replicas, the rate limiter needs a shared store (Redis is the natural fit *here*, unlike for sessions — this is the legitimate reason to eventually add it).
- **`trust proxy: 1`** in Express — trusts exactly one hop of `X-Forwarded-For` from nginx. Don't widen this without re-examining rate-limit key derivation.

## Current implementation state (verified directly against the pushed branch)

### Backend — built, typechecked, and (mostly) live-tested
`apps/backend/src/`: `config/auth.config.ts`, `lib/env.ts` (shared `requireEnv`, also used by `data-source.ts`), `lib/tokens.ts` (opaque token generation/hashing), `lib/errors.ts`, `entities/access-session.entity.ts` (+ migration `AddAccessSessions...`), `services/auth.service.ts` (signUpCustomer, loginCustomer, rotateRefreshToken, revokeFamily, logout, getUserById), `middleware/auth.middleware.ts`, `middleware/rate-limit.ts`, `middleware/error-handler.ts`, `validation/validate.ts`, `validation/auth.schemas.ts`, `routes/auth.routes.ts`, `index.ts`. `entities/user.entity.ts` modified (`role` column fix — see bug below). `Dockerfile` modified (curl in `backend-dev` stage only).

**Small known cleanup item**: `jsonwebtoken` and `@types/jsonwebtoken` are still listed in `apps/backend/package.json` but are **not imported anywhere in the source** (confirmed via grep) — leftover from before the JWT→opaque-token redesign. Safe to remove; harmless if left, just dead weight.

### Verified live, in the actual dev environment (not just typechecked)
- **Sign-up**: full flow confirmed correct — password hashing, cookie setting (`HttpOnly`, correct paths/expiries), and (after a real bug hunt) correct `role` in the response.

### NOT yet verified live — next session should start here
Login (right/wrong password), account lockout, refresh rotation, refresh-token reuse detection (theft simulation), `/me`, logout. All of these **were verified working in a separate sandbox environment by the AI agent during design**, but that is not the same as confirmed in this project's actual dev container — this project has already surfaced multiple environment-specific bugs that a generic test couldn't have caught (see below). Don't assume they work here until actually tested here.

### Frontend — ⚠️ NOT started in this repo yet

**Correction from an earlier draft of this file**: `apps/frontend/src/App.svelte` is confirmed, directly, to still be the **unmodified default Vite/Svelte scaffold** (`Counter.svelte`, the "Get started" demo, `svelte.svg`/`vite.svg` all present and unchanged). There is **no `lib/api/auth.ts`, no `MarketingSignupBar.svelte`, no `CustomerSignUp.svelte`** anywhere in the pushed branch.

An AI agent sandbox session earlier in this project's design phase *did* build a working version of all of these (cookie-based fetch client, the two README auth entry-point components, a rewritten `App.svelte`) — but that work was exploratory/illustrative and was never carried into the actual step-by-step build session that produced this repo's real commits. The backend was built file-by-file, live-tested, and debugged in this repo; the frontend was not. Treat the frontend as **not started**, full stop — don't assume any prior frontend work exists here without checking the actual files first.

## Bugs found and fixed this session (institutional knowledge — don't reintroduce)

1. **`.devcontainer/docker-compose.extend.yml` was missing `env_file` entirely**, so the `backend-dev` service silently never got `.env` values (crashed on missing `JWT_ACCESS_SECRET`). Fixed by adding `env_file: ./.env` — note the path is relative to the **Compose project directory** (repo root, where `docker compose` is invoked from), not relative to the file that declares it. This is the opposite of normal intuition and cost real debugging time — verify with `docker compose -f a.yml -f b.yml config` before assuming a path is right.
2. **`tsx watch` does not reliably restart on file changes in this WSL2 + Docker bind-mount setup**, and can end up with two zombie watcher processes bound to the same port, where the *stale* one silently keeps serving old code while the new one fails to bind. Symptom: edits appear to have no effect even though the file, typecheck, and git diff all look correct. Standing mitigation: after any edit to backend code, kill and manually restart `pnpm --filter backend run dev` rather than trusting the watcher — check `ps aux | grep tsx` for duplicates if something seems stale.
3. **`User.role` (the STI discriminator) was declared as an undecorated, bare `readonly role!: UserRole` property** with a comment claiming TypeORM populates it automatically. It doesn't — without a real `@Column` mapping, TypeORM's `@TableInheritance` mechanism uses the discriminator internally (to pick which subclass to instantiate) but never copies the value onto a plain property. Fixed with `@Column({ type: "varchar", name: "role", update: false })` (the `update: false` option is TypeORM 1.0's replacement for the removed `readonly` column option) — and `role` must still be **explicitly set** in `signUpCustomer`'s `.create({...})` call; the column mapping fixes *reading*, not writing. (An earlier attempted fix added `insert: false` too, reasoning it should be fully read-only from the app's side — that broke inserts entirely with a Postgres `NOT NULL` violation, since nothing was left to write the value at all. Don't add `insert: false` back.) **Confirmed both halves of this fix are actually in the pushed code.**
4. Terminal multi-line pastes in this environment occasionally concatenate two separate commands into one garbled line (seen with `tsc --noEmit` + `pnpm --filter backend run typeorm` merging). If a command produces a nonsensical "unknown option" error that doesn't match anything in the actual command, suspect this before suspecting the tool.
5. **A `CLAUDE.md` handoff file was written but pushed as an empty (0-byte) file** — the content was drafted but apparently never actually saved to disk before `git add`/commit. This file is the fix. If context-handoff files seem to be missing content in the future, check the actual file size/content on the branch, don't assume "it exists" means "it has the content."

## Explicitly out of scope so far (don't assume these exist)

- **The entire frontend beyond the default scaffold** (see correction above — this is a bigger gap than earlier notes suggested).
- Marketing-lead capture backend (`POST /leads` — no auth, no account creation, just email/phone + rate limiting).
- Guest/anonymous basket JWT and its merge into a new account on sign-up (described in the README as core to the checkout flow — not designed or built yet).
- Password reset flow.
- A UI entry point for a *returning* customer to log in (as opposed to sign-up) — the README doesn't specify where this lives; needs a product decision.
- Admin/operator accounts and any admin UI (`AdminUser`/`OperatorUser` child entities don't exist yet, only `CustomerUser`).
- TLS/HTTPS termination at nginx (domain is registered; TLS setup itself not started).
- Any CI, dependency scanning, or automated testing.

## Suggested immediate next steps (in order)

1. **Finish live backend endpoint verification** (see "NOT yet verified" above) — login, lockout, refresh rotation, reuse-detection replay test, `/me`, logout. This was mid-flight when the last session ended and should be finished before building anything on top of it.
2. Remove the unused `jsonwebtoken`/`@types/jsonwebtoken` dependencies (small, safe cleanup).
3. **Then**, and only then, start the frontend for real — it hasn't been touched. Recommend the same file-by-file, typecheck-then-test rhythm used for the backend, rather than a large batch change.
4. Once a minimal sign-up form exists and is live-tested against the real backend, resolve the frontend-dev-server networking gap (`vite dev` outside the container currently can't reach the backend on `localhost:3000` — needs either a temporarily-exposed port or a devcontainer-based frontend dev workflow; not yet solved).
5. Build the `/leads` marketing-capture endpoint (small, low-risk).
6. Design the guest-basket-JWT-to-account merge flow described in the README.
7. TLS/nginx setup for the registered domain, once ready to deploy past local dev.
8. Open (or continue) a PR from `feat/customer-auth` into `main` for review before merging — do not merge un-reviewed, given this branch is entirely authentication logic.

## Working-style notes for whoever picks this up

This project has been built in small, verified increments — one file or one command at a time, with an explicit confirmation (typecheck output, live test result) before moving to the next step, rather than large multi-file changes applied on trust. That pace surfaced several real bugs (see above) that would have been much harder to isolate in a larger batch of changes, and also caught this file's own empty-push mistake. Recommend continuing that way rather than reverting to bigger steps for speed — and specifically, recommend **verifying claims against the actual repository state** (file contents, sizes, git diffs) rather than trusting a prior session's summary of what it believes it did, exactly as this rewrite just did.