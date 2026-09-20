# CLAUDE.md — fra.rw project context

This file exists to bring a new AI agent session up to speed quickly. It covers what's been built, why specific decisions were made, what's verified vs. not, and what to do next. Read this before touching the codebase.

**Last updated at the end of the "security test suite" session.** The previous version was checked against `main` at `28f63c5`. Everything under "This session" below was verified live in the working tree (typecheck + the security suite through nginx) — confirm it has actually been committed and pushed (`git log --oneline -5`) before trusting that it's on `main`.

## Merge status

As of `28f63c5`, `main` contains the sign-up/login/refresh implementation, Swagger UI, and the pnpm/`.npmrc` migration (PR #2 `c623dd9`), plus the CLAUDE.md commits after it. **`main` and `feat/customer-auth` have diverged again** (they differ in `CLAUDE.md` and `.gitignore`; `main` is ahead). This session's work (see "This session" below) started from `main`. Branches in this repo get reused and pushed forward rather than cut fresh, which has caused stale merge-status claims in this file three times now — always check `git log --oneline -10` on both branches before trusting this section.

## Project basics

- **Stack**: pnpm workspace monorepo. `apps/backend` — Node.js 22, TypeScript (strict, `verbatimModuleSyntax`, `nodenext` modules — relative imports need explicit `.js` extensions), Express 5, TypeORM 1.x (see below — **not the more commonly-referenced 0.3.x line**) against PostgreSQL 16. `apps/frontend` — Svelte 5 + Vite.
- **Package manager**: pnpm, **pinned** to `pnpm@11.23.0` via `packageManager` in root `package.json`. This pin matters — see "pnpm 11 configuration migration" below; an unpinned `packageManager` field caused real, hard-to-diagnose build breakage this session.
- **Infra target**: single-host cloud instance, Docker Compose, nginx in front (TLS termination planned there, not yet implemented). `docker-compose.yml` (root) is the production config; `.devcontainer/docker-compose.extend.yml` overrides the `backend` service for local dev only (`backend-dev` build target, bind-mounted source, hot reload via `tsx watch`).
- **Dev environment**: VS Code Dev Containers, project lives in an AlmaLinux 9.7 WSL2 instance on the developer's laptop.
- **Payments (planned, not built)**: IremboPay or a similar regional processor, via hosted checkout (keeps card data off this server — SAQ-A PCI scope, not SAQ-D).

## ⚠️ TypeORM is on v1.x, not v0.3.x

`apps/backend/package.json` resolves `typeorm@^1.1.0`. TypeORM hit a genuine 1.0 release on 2026-05-19 — this is **not** a typosquat or supply-chain issue (verified against typeorm.io's own release notes). Training data / general knowledge about TypeORM likely reflects 0.3.x behavior — check `typeorm.io` (defaults to 1.x docs; 0.3.x is at `v0.typeorm.io`) or the installed `.d.ts` files before relying on an API. A real behavioral gap (STI discriminator columns not auto-populating) was found and fixed previously — see "Bugs found and fixed" below.

## This session: auth security test suite (`tests/security/`)

Bash, black-box over HTTP **through nginx** (`localhost:8080/api` by default), grey-box via direct Postgres access for fixtures and for verifying what the server stored. 14 tests, one per adopted security principle, in priority order: opaque/hashed tokens, refresh rotation + theft + race, server-side logout, per-request session validation, password storage, lockout, login enumeration (incl. timing), sign-up enumeration, sign-up mass assignment, cookie hardening, input hardening, Swagger gating, Origin/Referer CSRF check, and rate limit vs. spoofed `X-Forwarded-For`. The destructive rate-limit test is numbered **99** so it always sorts last — add new tests with numbers below it, and keep an eye on the login budget: a test that needs an *allowed* state-changing request should prefer `/auth/refresh` (60 per 15 min) over `/auth/login` (20).

- **Run from the WSL terminal at the repo root, not inside the dev container** (needs nginx on `:8080` and `docker` for DB access). No `sudo` needed.
  `FRA_RESET_CMD='touch apps/backend/src/index.ts && sleep 6' tests/security/run-all.sh` — `--safe` skips the destructive test; `run-all.sh 02 06` runs a subset.
- **Rate-limit budget is the main operational constraint.** One full run uses ~9 of 10 sign-ups/hour and ~17 of 20 logins/15 min per IP, then test 13 exhausts logins. The limiter is in-memory, so restarting the backend clears it — `FRA_RESET_CMD` above does that via `tsx watch`. A 429 mid-test reports **BLOCKED** (inconclusive), never FAIL.
- **Fixtures, not sign-ups, wherever possible**: `lib.sh` inserts users straight into the DB with a precomputed Argon2id hash (made with `@node-rs/argon2`, the app's own library) and mints sessions by writing SHA-256 token hashes, exactly as the server does. Real sign-up/login is only used where issuance itself is under test.
- **Cleanup**: every test user is `sectest+…@fra.test`, hard-deleted on exit (sessions cascade); `run-all.sh` also sweeps leftovers. The suite should never leave rows behind — if it does, that's a bug.
- **Harness safety**: a test that exits early without reaching `finish`, or runs zero checks, is reported as ERROR rather than PASS (both happened to be possible before; an empty test file used to pass silently).
- **The tests were mutation-checked**, not just run green: deliberately breaking `trust proxy`, the lockout check, the dummy hash for unknown emails, the refresh claim, and nginx's `proxy_redirect` each turned the matching test red. Two vacuous checks were found and fixed this way — keep doing it when adding tests.
- **Green is necessary, not sufficient.** After merging PR #4, `main` was found to never save the rotated refresh token (every session died at its second refresh), and test 02 had two checks merged onto one line (the second always passed) — both from hand-applying edits, and the suite was green throughout. Test 02 now refreshes twice in a row (R0 → R1 → R2) to catch the first; the second was only found by diffing pushed files against the tested ones. After applying edits by hand, run the verification greps given with the change, not just the suite.
- **CSRF defense-in-depth (this session)**: `middleware/origin-check.ts` rejects state-changing requests (anything but GET/HEAD/OPTIONS) whose `Origin` — or `Referer`, as fallback — isn't in `ALLOWED_ORIGINS`, returning 403 `CROSS_ORIGIN_BLOCKED` and logging `cross_origin_request_blocked`. Exact origin match, so `http://localhost:8080.evil.com` and `https://localhost:8080` both fail. **Requests with neither header are allowed**: browsers always send `Origin` on cross-site POST, so those are non-browser callers (curl, health checks, future payment webhooks) and rejecting them would break them for nothing. Mounted app-wide before the routers, so blocked requests don't reach handlers or spend rate-limit budget. `ALLOWED_ORIGINS` is required in production and defaults to `http://localhost:8080,http://localhost:5173` in dev. Enforced by test 14; mutation-checked by unmounting it and by swapping the exact match for a substring match.
- **Convention going forward: every new security-relevant behaviour gets a test here in the same change**, and a principle only counts as "adopted" once a test enforces it.

## This session: security fixes (each verified with the suite, before and after)

1. **Refresh-token race — high severity, fixed.** `rotateRefreshToken` checked `revokedAt` on a row read *before* its transaction, so parallel requests with one token all passed: up to 9 of 10 succeeded, forking up to 8 live refresh tokens and bypassing theft detection. Fixed with an **atomic claim**: `UPDATE refresh_tokens SET revoked_at, replaced_by_token_hash WHERE id = … AND revoked_at IS NULL`, proceeding only if `affected === 1`. Losers are treated as reuse: logged as `reused_concurrently`, whole family revoked (including the winner's new tokens). Now exactly 1 of 10 succeeds, every round. **Lesson: any "read, check, then write" on security state needs the check inside the write (conditional UPDATE / row lock), not before it.**
2. **Theft detection now logs** (`lib/security-log.ts`, one JSON line per event, grep `security_event`). `refresh_token_family_revoked` with `reason`: `reused` (rotated token replayed — warn), `reused_concurrently` (race loser — warn), `already_revoked` (token killed by logout/earlier revocation, i.e. fallout — info), `expired` (info). Includes presenting vs. originally-issued IP/UA; never raw tokens or hashes. Reuse this helper for future security events.
3. **Parser errors no longer become 500s.** Malformed JSON / body over 32kb / bad charset used to return 500 *and log a full stack trace per request* (log-flooding vector). `errorHandler` now passes body-parser's 4xx `http-errors` (`expose: true`) through with our own fixed code/message (`INVALID_JSON`, `PAYLOAD_TOO_LARGE`, else `BAD_REQUEST`) and doesn't log them. Real 500s are unchanged.
4. **Misleading `User` comments corrected**: `tokenVersion` is marked unused (JWT leftover; "logout everywhere" would delete session rows instead), `passwordChangedAt` marked not yet written, and the `role` comment no longer claims `insert: false` (which would reintroduce the NOT NULL bug). Comment-only — verified by diffing compiled JS.
5. Stray whitespace before `{` in `.devcontainer/devcontainer.json` trimmed.

## Previous session: Swagger UI for end-to-end API testing

`GET /docs` (via nginx: `http://localhost:8080/api/docs`) serves an interactive Swagger UI for the auth endpoints, spec at `apps/backend/src/docs/openapi.ts`. **Dev-only** — mounted only when `NODE_ENV !== "production"` (`index.ts`), so it's invisible in a real deploy.

- **Gated behind HTTP Basic Auth**: requires `SWAGGER_DOCS_USER` / `SWAGGER_DOCS_PASSWORD` env vars, fail-fast at boot like every other secret in `auth.config.ts` (`docsAuthCredentials()`). Not full 2FA — deliberately proportionate to an internal dev-only tool; revisit only if this ever gets deployed somewhere genuinely internet-reachable, not just a private dev/staging box.
- **Use the "Via nginx" server** in the dropdown, not "Direct to backend (:3000)" — hitting the backend directly bypasses nginx's `/api/` cookie-path rewrite and will make `/refresh`/`/logout` look broken even though they aren't (see next section for why).
- The spec (`openapi.ts`) is **hand-written, not generated** from the zod schemas — it'll drift out of sync over time if endpoints change without updating it. No CI check enforces this currently.

## Security fixes shipped in the previous session (verified live, through the real nginx path — not just curl)

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
- **Refresh token rotation + reuse detection**: replaying an already-rotated refresh token revokes the entire session family (both refresh and access sides, via shared `familyId`). Rotation is an atomic claim, so concurrent replays are caught too (see "This session: security fixes"). Enforced by test 02.
- **Argon2id via `@node-rs/argon2`**, not the `argon2` package — ships prebuilt bindings, no install script needed (relevant now that `ignore-scripts` moved to `allowBuilds`, see above).
- **Cookies**: `HttpOnly`, `Secure` (prod only), `SameSite=Lax` (not `Strict` — a payment-processor redirect-back is a cross-site top-level GET that `Strict` would drop the cookie on).
- **Login timing**: nonexistent-email login burns a throwaway Argon2 hash to resist timing-based enumeration. (Sign-up's equivalent gap was fixed in the previous session — see above.) Enforced by tests 07/08.
- **Rate limiting**: per-IP on `/sign-up`, `/login`, `/refresh`, layered on per-account DB lockout (10 failed attempts → 15 min lock, live-verified — including that the *correct* password is also rejected while locked).
- **`express-rate-limit`'s in-memory store only works single-instance.** Known gap if the project ever scales to multiple backend replicas — Redis would be the legitimate fit *there* (unlike for sessions).
- **`trust proxy: 1`** in Express — trusts exactly one nginx hop for `X-Forwarded-For`. Don't widen without re-examining rate-limit key derivation.

## Decisions taken, with expiry conditions

- **Lockout response stays `423 ACCOUNT_LOCKED` (decided, interim).** A locked account answers 423 while an unknown email answers 401, so ~10 failed attempts confirm an email is registered. Accepted deliberately: the per-IP login limit (20 per 15 min) makes this roughly one probe per IP per window, and the alternative (a generic 401 while locked) would tell a legitimate locked user that their correct password is "invalid", with no way to explain why until transactional email exists. **Revisit when email is live** — see the email item in next steps. Tests 06/07 encode the current behaviour, so changing it means changing them.
- **Account-lockout DoS is inherent and accepted.** Anyone who knows an address can lock it for 15 minutes. The window is the mitigation; an emailed unlock link would reduce it further, once email exists.

## Current implementation state

### Backend — live-verified through the real nginx path, and now enforced by `tests/security/` (all 13 passing)
Sign-up, login (right/wrong password), account lockout, refresh rotation, refresh-token reuse/theft detection, `/me`, logout — **all confirmed working live**, via Swagger UI through nginx at `localhost:8080/api/docs`, not just typechecked or curl-to-`:3000`. This closes out the "NOT yet verified" gap the previous version of this file flagged.

### Frontend — still NOT started
`apps/frontend/src/App.svelte` is still confirmed to be the **unmodified default Vite/Svelte scaffold**. No auth UI, no API client, nothing beyond what `create-vite` generates. Nothing changed here this session — still the biggest gap in the project.

## Environment-specific gotchas (institutional knowledge — save future debugging time)

- **VS Code Dev Containers + WSL2 auto-mounts a Wayland socket** for GUI app forwarding, which this backend-only project never needs, and it can fail container creation outright (`mount ... wayland-0 ... not a directory`) on some WSL2/AlmaLinux setups. Fix: disable `dev.containers.mountWaylandSocket` in VS Code user settings (local-machine setting, not committed to the repo).
- **Alpine's package mirror occasionally has transient DNS failures** during `apk add` mid-build (`DNS: transient error (try again later)` → `unable to select packages`). Usually resolves on a plain retry; if it repeats persistently rather than as a one-off, restart WSL2 (`wsl --shutdown` from PowerShell) to reset its network stack.
- **A Docker named volume (`backend_app_node_modules` etc.) can end up owned by a different UID than the container's `node` user**, causing `pnpm install` to fail with `Permission denied` on existing package directories — typically from an earlier build/run before the Dockerfile's `USER node` line took effect. Fix: delete and let Docker recreate the volume (`docker volume rm ...`), fresh volumes inherit the image's correct ownership.
- **`corepack`'s pnpm auto-fetch and the `packageManager` pin can drift**: local machine had pnpm 11.23.0 cached and working; an unpinned Docker build grabbed 12.4.x fresh each time, which has materially different (stricter) build-script approval behavior — see the pnpm 11 migration section above for the actual fix.
- **`tsx watch` stale processes, again**: while restarting the backend repeatedly, a new process failed to bind `:3000` while the old one kept serving old code, which made a test look like it passed against a change that wasn't running. Wait for the port to be free before trusting a restart.
- **Rate limits persist across suite runs** (in-memory, per IP). Back-to-back runs without `FRA_RESET_CMD` will show BLOCKED tests — that's the limiter working, not a regression.

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
- CI (the security suite exists but nothing runs it automatically), dependency scanning, and unit tests.

## Suggested immediate next steps, in order

1. **Small**: the hand-written `openapi.ts` has no drift check — at minimum, re-check it whenever an auth endpoint changes.
2. **Only after the above**: start the frontend for real. Same file-by-file, typecheck-then-live-test rhythm. The frontend-dev-server networking gap (`vite dev` outside the container can't reach the backend on `localhost:3000`) still needs solving first — not yet designed. Note `ALLOWED_ORIGINS` already allows `http://localhost:5173` in dev for exactly this.
3. `/leads` marketing-capture endpoint.
4. Guest-basket-JWT-to-account merge flow.
5. TLS/nginx setup once ready to deploy past local dev — then set `ALLOWED_ORIGINS` to the real https origins and run the suite with `FRA_EXPECT_SECURE=1`.
6. CI that runs `tests/security/run-all.sh` against a disposable stack.
7. **Transactional email, closer to deployment** (blocked on the Workspace/domain setup). Two auth changes come with it, in this order:
   - **Close the lockout oracle**: return the generic 401 while locked (i.e. identical to a wrong password and to an unknown email), and send the account owner a "we locked your account for 15 minutes" email, logged via `logSecurityEvent`. That is what makes the generic response affordable — the owner learns what happened, a prober learns nothing. Update tests 06/07 and add a test that the locked response is byte-identical to the unknown-email one. Optionally include an unlock link to blunt the lockout DoS.
   - **Close sign-up enumeration properly**: always answer "check your inbox" (identical response either way) and send one of two mails — "confirm your address" for a new address, or "someone tried to sign up with your address, here is a reset link" for an existing one. Replaces today's identical-409 approach with something equally safe and more useful; update test 08.
   - **Email plumbing is its own security surface**: codes/links hashed at rest with short TTLs and single use (same pattern as refresh tokens), send limits per address AND per IP so the endpoint can't be used to bomb an inbox, never log codes, and identical response timing whether or not the address exists.
   - **Sending**: Workspace is for humans, not app mail — Google scopes SMTP relay to printers/app-generated/low-volume business mail and explicitly not bulk, with the Gmail SMTP server capped around 2,000 messages/day and relay around 10,000 recipients/user/24h (lower on trial accounts). Use a transactional provider (Postmark, Resend, SES) authenticated on the same domain, so a bug in the app can never affect the real mailboxes. Verify current limits before relying on numbers.
   - **Login OTP / 2FA is a separate question** — good against credential stuffing, but it does NOT fix enumeration and can create a new oracle ("we sent a code" vs "invalid credentials"). Don't conflate it with the above.

## Working-style notes for whoever picks this up

This project moves in small, verified increments — one change at a time, with an explicit live-test or typecheck confirmation before the next step, rather than large multi-file changes applied on trust. This session specifically surfaced several bugs (the refresh-cookie path issue, the pnpm/`.npmrc` config-migration gap, the Dockerfile's dangling `.npmrc` reference) that would have been much harder to isolate in a bigger batch — and in two cases, a fix that looked complete on first pass (Swagger UI added but never actually gated behind auth; `REFRESH_TOKEN_COOKIE_PATH` constant created but not actually wired into its two call sites) turned out to be incomplete only once checked against the real pushed code rather than trusted from a prior turn's description. **Verify claims against the actual repository state — git diff, file contents, live requests through the real proxy path — rather than trusting a summary of what a previous session believes it did.**

**Answer format the project owner asked for**: for each key piece of a change (and for whole features / complete testable workflows), present **1. explanation, 2. code to write, 3. where to write it** — exact file (existing or new) and exact location in it — rather than a single patch file. When a change is testable, include how to verify it through the real nginx path, ideally with the security suite.
