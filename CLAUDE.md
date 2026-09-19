# CLAUDE.md — fra.rw project context

This file exists to bring a new AI agent session up to speed quickly. It covers what's been built, why specific decisions were made, what's verified vs. not, and what to do next. Read this before touching the codebase.

**This version was checked directly against `main` on GitHub** (commit `c623dd9`, "Merge pull request #2 from drakstik/feat/customer-auth") — not written from memory of the working session.

## Merge status

Everything in this document — the sign-up/login/refresh implementation, the three security fixes, Swagger UI, and the pnpm/`.npmrc` migration — **is merged into `main`** as of PR #2 (`c623dd9`). `main` and `feat/customer-auth` are in sync (confirmed via `git diff origin/main origin/feat/customer-auth --stat` — empty). No outstanding PR for this work. If a future session finds `main` and `feat/customer-auth` have diverged again, check `git log --oneline -10` on both before trusting this file's claim — branches get reused and pushed forward in this repo rather than always cut fresh, which has caused stale merge-status claims in this file before (twice, in fact — don't make it three times).

## Project basics

- **Stack**: pnpm workspace monorepo. `apps/backend` — Node.js 22, TypeScript (strict, `verbatimModuleSyntax`, `nodenext` modules — relative imports need explicit `.js` extensions), Express 5, TypeORM 1.x (see below — **not the more commonly-referenced 0.3.x line**) against PostgreSQL 16. `apps/frontend` — Svelte 5 + Vite.
- **Package manager**: pnpm, **pinned** to `pnpm@11.23.0` via `packageManager` in root `package.json`. This pin matters — see "pnpm 11 configuration migration" below; an unpinned `packageManager` field caused real, hard-to-diagnose build breakage this session.
- **Infra target**: single-host cloud instance, Docker Compose, nginx in front (TLS termination planned there, not yet implemented). `docker-compose.yml` (root) is the production config; `.devcontainer/docker-compose.extend.yml` overrides the `backend` service for local dev only (`backend-dev` build target, bind-mounted source, hot reload via `tsx watch`).
- **Dev environment**: VS Code Dev Containers, project lives in an AlmaLinux 9.7 WSL2 instance on the developer's laptop.
- **Payments (planned, not built)**: IremboPay or a similar regional processor, via hosted checkout (keeps card data off this server — SAQ-A PCI scope, not SAQ-D).

## ⚠️ TypeORM is on v1.x, not v0.3.x

`apps/backend/package.json` resolves `typeorm@^1.1.0`. TypeORM hit a genuine 1.0 release on 2026-05-19 — this is **not** a typosquat or supply-chain issue (verified against typeorm.io's own release notes). Training data / general knowledge about TypeORM likely reflects 0.3.x behavior — check `typeorm.io` (defaults to 1.x docs; 0.3.x is at `v0.typeorm.io`) or the installed `.d.ts` files before relying on an API. A real behavioral gap (STI discriminator columns not auto-populating) was found and fixed previously — see "Bugs found and fixed" below.

## New this session: Swagger UI for end-to-end API testing

`GET /docs` (via nginx: `http://localhost:8080/api/docs`) serves an interactive Swagger UI for the auth endpoints, spec at `apps/backend/src/docs/openapi.ts`. **Dev-only** — mounted only when `NODE_ENV !== "production"` (`index.ts`), so it's invisible in a real deploy.

- **Gated behind HTTP Basic Auth**: requires `SWAGGER_DOCS_USER` / `SWAGGER_DOCS_PASSWORD` env vars, fail-fast at boot like every other secret in `auth.config.ts` (`docsAuthCredentials()`). Not full 2FA — deliberately proportionate to an internal dev-only tool; revisit only if this ever gets deployed somewhere genuinely internet-reachable, not just a private dev/staging box.
- **Use the "Via nginx" server** in the dropdown, not "Direct to backend (:3000)" — hitting the backend directly bypasses nginx's `/api/` cookie-path rewrite and will make `/refresh`/`/logout` look broken even though they aren't (see next section for why).
- The spec (`openapi.ts`) is **hand-written, not generated** from the zod schemas — it'll drift out of sync over time if endpoints change without updating it. No CI check enforces this currently.

## Security fixes shipped this session (verified live, through the real nginx path — not just curl)

1. **Sign-up enumeration closed.** `signUpCustomer` used to return distinct `EMAIL_TAKEN`/`PHONE_TAKEN` errors, letting `/sign-up` be used to probe which specific field was already registered — while `loginCustomer` deliberately avoids the equivalent timing-based leak. Now a single query + single generic `ACCOUNT_EXISTS` (409) error for either collision (`lib/errors.ts`, `services/auth.service.ts`). Verified: signing up with a known email + new phone, and a new email + known phone, now return byte-identical response bodies.

2. **Refresh-cookie path bug — this was the big one.** The refresh-token cookie's `Path` was hardcoded to `/auth` (the backend's own internal Express route prefix). But nginx proxies the browser-facing `/api/` prefix down to the backend's root (stripping `/api`), so the browser only ever sees `/api/auth/*` — a cookie scoped to `/auth` silently never got attached to `/api/auth/refresh` or `/api/auth/logout` requests. **Confirmed broken via a real nginx instance before the fix (refresh returned 401), confirmed fixed after (refresh returned 200)** — this is not a curl-only verification, curl-to-`:3000` directly would never have caught it since it bypasses nginx entirely.
   - Fix is two coordinated changes: backend keeps `REFRESH_TOKEN_COOKIE_PATH = "/auth"` in its own route space (`auth.config.ts`) — deliberately does **not** know about nginx's external prefix — and nginx does the translation itself via `proxy_cookie_path /auth /api/auth;` (`apps/frontend/nginx.conf`), symmetric to the `proxy_pass` stripping it already does for requests.
   - A related, separate bug: `swagger-ui-express`'s automatic `/docs` → `/docs/` redirect also loses the `/api` prefix the same way (issues a root-relative `Location: /docs/` instead of `/api/docs/`). Fixed with `proxy_redirect /docs/ /api/docs/;` in the same nginx location block.
   - **If this ever needs debugging again**: don't trust `curl http://localhost:3000/...` (bypasses nginx). Either curl through `http://localhost:8080/api/...`, or use the Swagger UI's "Via nginx" server.

3. **Dead JWT artifacts fully removed.** `JWT_ACCESS_SECRET` (a required, fail-fast env var) and the `jsonwebtoken`/`@types/jsonwebtoken` packages were leftover from before the JWT→opaque-token redesign and were never actually used anywhere — confirmed via grep before removal, and confirmed the server still boots and functions correctly with `JWT_ACCESS_SECRET` completely unset after removal. Gone from `auth.config.ts`, `package.json`, and `.env.example`.

## pnpm 11 configuration migration (environment gotcha, not app code)

Root `package.json` didn't originally pin `packageManager`, so `corepack` silently fetched whatever pnpm was newest on each fresh build — this caused a real, previously-invisible problem: **pnpm 11+ only reads auth/registry settings from `.npmrc`**; everything else (`store-dir`, `inject-workspace-packages`, and critically `ignore-scripts=true` — this repo's deliberate supply-chain protection) was silently not being applied, with no warning. Confirmed via `pnpm config get store-dir` returning `undefined` despite `.npmrc` setting it.

- **Fixed**: `packageManager: "pnpm@11.23.0"` pinned in root `package.json`. `storeDir` and `injectWorkspacePackages` moved into `pnpm-workspace.yaml` (the pnpm 11+ location for non-auth settings). **`.npmrc` deleted entirely** — it had nothing left to do (no registry/auth config currently needed).
- `ignore-scripts`'s job is now done by `pnpm-workspace.yaml`'s `allowBuilds` map instead, which is **default-deny**: a dependency's install/postinstall script only runs if explicitly set to `true` there. Currently: `esbuild: true` (legitimately needs its native binary), `'@scarf/scarf': false` (telemetry, explicitly blocked). If a new dependency's install fails with `ERR_PNPM_IGNORED_BUILDS`, this is where to look — **do not run `pnpm approve-builds` to blanket-approve**, add the specific package to `allowBuilds` deliberately after checking what its script does.
- `Dockerfile` had two `COPY ... .npmrc ./` lines referencing the now-deleted file — broke the build with `"/.npmrc": not found` until removed from both `COPY` lines (the `build` stage and the `backend-dev` stage).

## Security architecture — decisions and why (unchanged from before, still current)

- **Access tokens are opaque, DB-backed, not JWTs.** Rejected signed JWTs specifically because JWT payloads are readable (not encrypted) by anything that captures the raw token. Opaque tokens carry zero information if captured. Trade-off: a DB read per authenticated request, accepted at current scale (~1000 concurrent users).
- **Redis rejected for session storage** on security grounds — a new network-facing service with real breach history, vs. Postgres adding zero new attack surface. Revisit only if the project needs multiple backend instances.
- **Refresh token rotation + reuse detection**: live-verified this session, including the actual theft scenario — replaying an already-rotated refresh token revokes the entire session family (both refresh and access sides, via shared `familyId`).
- **Argon2id via `@node-rs/argon2`**, not the `argon2` package — ships prebuilt bindings, no install script needed (relevant now that `ignore-scripts` moved to `allowBuilds`, see above).
- **Cookies**: `HttpOnly`, `Secure` (prod only), `SameSite=Lax` (not `Strict` — a payment-processor redirect-back is a cross-site top-level GET that `Strict` would drop the cookie on).
- **Login timing**: nonexistent-email login burns a throwaway Argon2 hash to resist timing-based enumeration. (Sign-up's equivalent gap was the bug fixed this session — see above.)
- **Rate limiting**: per-IP on `/sign-up`, `/login`, `/refresh`, layered on per-account DB lockout (10 failed attempts → 15 min lock, live-verified — including that the *correct* password is also rejected while locked).
- **`express-rate-limit`'s in-memory store only works single-instance.** Known gap if the project ever scales to multiple backend replicas — Redis would be the legitimate fit *there* (unlike for sessions).
- **`trust proxy: 1`** in Express — trusts exactly one nginx hop for `X-Forwarded-For`. Don't widen without re-examining rate-limit key derivation.

## Current implementation state

### Backend — fully live-verified this session, through the real nginx path
Sign-up, login (right/wrong password), account lockout, refresh rotation, refresh-token reuse/theft detection, `/me`, logout — **all confirmed working live**, via Swagger UI through nginx at `localhost:8080/api/docs`, not just typechecked or curl-to-`:3000`. This closes out the "NOT yet verified" gap the previous version of this file flagged.

### Frontend — still NOT started
`apps/frontend/src/App.svelte` is still confirmed to be the **unmodified default Vite/Svelte scaffold**. No auth UI, no API client, nothing beyond what `create-vite` generates. Nothing changed here this session — still the biggest gap in the project.

## Environment-specific gotchas hit this session (institutional knowledge — save future debugging time)

- **VS Code Dev Containers + WSL2 auto-mounts a Wayland socket** for GUI app forwarding, which this backend-only project never needs, and it can fail container creation outright (`mount ... wayland-0 ... not a directory`) on some WSL2/AlmaLinux setups. Fix: disable `dev.containers.mountWaylandSocket` in VS Code user settings (local-machine setting, not committed to the repo).
- **Alpine's package mirror occasionally has transient DNS failures** during `apk add` mid-build (`DNS: transient error (try again later)` → `unable to select packages`). Usually resolves on a plain retry; if it repeats persistently rather than as a one-off, restart WSL2 (`wsl --shutdown` from PowerShell) to reset its network stack.
- **A Docker named volume (`backend_app_node_modules` etc.) can end up owned by a different UID than the container's `node` user**, causing `pnpm install` to fail with `Permission denied` on existing package directories — typically from an earlier build/run before the Dockerfile's `USER node` line took effect. Fix: delete and let Docker recreate the volume (`docker volume rm ...`), fresh volumes inherit the image's correct ownership.
- **`corepack`'s pnpm auto-fetch and the `packageManager` pin can drift**: local machine had pnpm 11.23.0 cached and working; an unpinned Docker build grabbed 12.4.x fresh each time, which has materially different (stricter) build-script approval behavior — see the pnpm 11 migration section above for the actual fix.

## Bugs found and fixed in earlier sessions (still relevant, don't reintroduce)

1. `.devcontainer/docker-compose.extend.yml` needs `env_file: ./.env` — path is relative to the **Compose project directory** (repo root), not the file declaring it.
2. `tsx watch` can leave zombie processes bound to the same port in this WSL2 + bind-mount setup, where the stale process silently keeps serving old code. If an edit seems to have no effect, check `ps aux | grep tsx` for duplicates before assuming the edit is wrong.
3. `User.role` (STI discriminator) needs an explicit `@Column({ type: "varchar", name: "role", update: false })` — TypeORM's `@TableInheritance` doesn't auto-populate a bare undecorated property. `role` must also still be explicitly set in `signUpCustomer`'s `.create({...})` call. **Don't add `insert: false`** — that breaks inserts with a `NOT NULL` violation.

## Explicitly out of scope so far

- The entire frontend beyond the default scaffold.
- Marketing-lead capture backend (`POST /leads`).
- Guest/anonymous basket JWT and its merge into a new account on sign-up.
- Password reset flow.
- A UI entry point for returning-customer login (README doesn't specify where this lives — needs a product decision).
- Admin/operator accounts and any admin UI.
- TLS/HTTPS termination at nginx.
- Any CI, dependency scanning, or automated testing.

## Suggested immediate next steps, in order

1. **Documentation-only fix**: `User` entity's `tokenVersion`/`passwordChangedAt` columns have a doc comment claiming they're checked on every request to enforce "logout everywhere" — they're not; `requireAuth` never reads `tokenVersion`, and nothing increments it. Either correct the misleading comment, or actually build the feature (would need a new "revoke all sessions for user X" function — doesn't require `tokenVersion` at all, just deleting all of that user's `access_sessions`/`refresh_tokens` rows).
2. **Small**: add a log line on the refresh-token reuse/theft-detection branch (`rotateRefreshToken`'s `revokeFamily` path in `auth.service.ts`) — currently the strongest signal of an actual account-takeover attempt in the codebase logs nothing at all.
3. **Small-medium**: add an Origin/Referer check as defense-in-depth on `/auth/*` POST routes, on top of the existing `SameSite=Lax` protection — cheap, closes the residual gap for browsers that don't fully honor `SameSite`.
4. **Cosmetic, low priority**: `.devcontainer/devcontainer.json` picked up a stray leading whitespace before its opening `{` at some point this session (harmless — JSON.parse ignores it — but worth a quick trim next time that file's open).
5. **Only after the above**: start the frontend for real. Same file-by-file, typecheck-then-live-test rhythm that worked for the backend, not a large batch change. The frontend-dev-server networking gap (`vite dev` outside the container can't reach the backend on `localhost:3000`) still needs solving first — not yet designed.
6. `/leads` marketing-capture endpoint.
7. Guest-basket-JWT-to-account merge flow.
8. TLS/nginx setup once ready to deploy past local dev.

## Working-style notes for whoever picks this up

This project moves in small, verified increments — one change at a time, with an explicit live-test or typecheck confirmation before the next step, rather than large multi-file changes applied on trust. This session specifically surfaced several bugs (the refresh-cookie path issue, the pnpm/`.npmrc` config-migration gap, the Dockerfile's dangling `.npmrc` reference) that would have been much harder to isolate in a bigger batch — and in two cases, a fix that looked complete on first pass (Swagger UI added but never actually gated behind auth; `REFRESH_TOKEN_COOKIE_PATH` constant created but not actually wired into its two call sites) turned out to be incomplete only once checked against the real pushed code rather than trusted from a prior turn's description. **Verify claims against the actual repository state — git diff, file contents, live requests through the real proxy path — rather than trusting a summary of what a previous session believes it did.**
