#!/usr/bin/env bash
# Shared helpers for the auth security test suite. Sourced by every test.
#
# Black-box: every attack goes over HTTP, through nginx by default.
# Grey-box: tests may read/write Postgres directly to set up fixtures,
# fast-forward state (e.g. failed-login counters) and verify what the
# server stored. Every user a test creates is deleted on exit.
#
# Config (env vars, all optional):
#   FRA_BASE        API base URL           (default http://localhost:8080/api)
#   FRA_PSQL        psql command to use     (default: docker exec into the
#                   compose "postgres" service, credentials from repo .env)
#   FRA_LOGS_CMD    command printing recent backend logs (default: docker
#                   logs of the compose "backend" service)
#   FRA_EXPECT_SECURE=1   require the Secure cookie flag (production/TLS)
#
# Exit codes: 0 pass, 1 fail, 2 blocked (rate-limited), 3 harness error.
set -uo pipefail

SEC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SEC_DIR/../.." && pwd)"
BASE="${FRA_BASE:-http://localhost:8080/api}"
TMP="$(mktemp -d)"
FAILS=0
FINISHED=0
ALLOW_429=0
CREATED_EMAILS=()

# Known password + its Argon2id hash (made with @node-rs/argon2, same
# library and defaults as the app), so fixture users can be inserted
# straight into the DB without spending the sign-up rate limit.
FIXTURE_PASSWORD='Fixture-Password-1234'
FIXTURE_HASH='$argon2id$v=19$m=19456,t=2,p=1$ZfQXa3ag8XBcJ71+IjBevQ$FzBiidoRHgJhpGZIOW7aWsmzb4dYuak1oTL+jZ0AQng'

# ---------- output ----------
principle() { printf '\n\033[1m[%s] %s\033[0m\n' "$(basename "$0" .sh)" "$1"; }
pass()      { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail()      { FAILS=$((FAILS + 1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; [[ -n "${2:-}" ]] && printf '       -> %s\n' "${2:0:300}"; return 0; }
skip()      { printf '  \033[36mSKIP\033[0m %s\n' "$1"; }
blocked()   { printf '  \033[33mBLOCKED\033[0m %s\n' "$1"; exit 2; }
harness_error() { printf '  \033[35mERROR\033[0m %s\n' "$1" >&2; exit 3; }
finish()    { FINISHED=1; (( FAILS > 0 )) && exit 1; exit 0; }

# ---------- assertions ----------
# ok $? "desc" [detail]  -- use after an inline test:  [[ ... ]]; ok $? "desc"
ok()               { if [[ "$1" == 0 ]]; then pass "$2"; else fail "$2" "${3:-}"; fi; }
# check "desc" command args...  -- for real commands/functions, not [[ ]]
check()            { local d=$1; shift; if "$@"; then pass "$d"; else fail "$d"; fi; }
expect_status()    { if [[ "$STATUS" == "$1" ]]; then pass "$2 (HTTP $STATUS)"; else fail "$2" "expected HTTP $1, got $STATUS: $BODY"; fi; }
expect_eq()        { if [[ "$1" == "$2" ]]; then pass "$3"; else fail "$3" "expected '$2', got '$1'"; fi; }
expect_ne()        { if [[ "$1" != "$2" ]]; then pass "$3"; else fail "$3" "both were '$1'"; fi; }
expect_code()      { if [[ "$BODY" == *"\"code\":\"$1\""* ]]; then pass "$2"; else fail "$2" "expected error code $1, body: $BODY"; fi; }
expect_absent()    { if [[ "$1" != *"$2"* ]]; then pass "$3"; else fail "$3" "found '$2'"; fi; }

# ---------- config / DB ----------
env_get() {
  grep -E "^$1=" "$REPO_ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/[[:space:]]+#.*$//; s/^"(.*)"$/\1/'
}
container_for() { docker ps -q --filter "label=com.docker.compose.service=$1" 2>/dev/null | head -1; }

# sql "STATEMENT" -> prints result rows, unaligned, no headers.
sql() {
  if [[ -n "${FRA_PSQL:-}" ]]; then
    $FRA_PSQL -tAq -v ON_ERROR_STOP=1 -c "$1"
  else
    local c; c=$(container_for postgres)
    [[ -z "$c" ]] && harness_error "no postgres container found; set FRA_PSQL"
    docker exec -i "$c" psql -U "$(env_get DB_USER)" -d "$(env_get DB_NAME)" \
      -tAq -v ON_ERROR_STOP=1 -c "$1"
  fi
}

backend_logs() {
  if [[ -n "${FRA_LOGS_CMD:-}" ]]; then eval "$FRA_LOGS_CMD"; return; fi
  local c; c=$(container_for backend)
  [[ -n "$c" ]] && docker logs --since 10m "$c" 2>&1
}

# ---------- HTTP ----------
# http METHOD PATH [JSON_BODY] [COOKIE_HEADER] [extra curl args...]
# Sets STATUS, BODY, TIME; response headers are in $TMP/headers.
http() {
  local method=$1 path=$2 body=${3:-} cookie=${4:-}
  shift $(( $# < 4 ? $# : 4 ))
  local args=(-sS -o "$TMP/body" -D "$TMP/headers" -w '%{http_code} %{time_total}' -X "$method")
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' --data-binary "$body")
  [[ -n "$cookie" ]] && args+=(-H "Cookie: $cookie")
  local out
  out=$(curl "${args[@]}" "$@" "$BASE$path") || harness_error "curl failed: $method $BASE$path"
  STATUS=${out%% *}; TIME=${out#* }; BODY=$(cat "$TMP/body")
  if [[ "$STATUS" == 429 && "$ALLOW_429" != 1 ]]; then
    blocked "rate-limited on $method $path; reset limits (see run-all.sh) and re-run"
  fi
}

set_cookie_line() { grep -i "^set-cookie: $1=" "$TMP/headers" | tail -1 | tr -d '\r'; }
cookie_val()      { set_cookie_line "$1" | sed -E "s/^[Ss]et-[Cc]ookie: $1=([^;]*).*/\1/"; }
cookie_cleared()  { local l; l=$(set_cookie_line "$1"); [[ "$l" == *"$1=;"* && ( "$l" == *"1970"* || "$l" == *"Max-Age=0"* ) ]]; }
session_cookies() { ACCESS=$(cookie_val access_token); REFRESH=$(cookie_val refresh_token); }

login()   { http POST /auth/login "{\"email\":\"$1\",\"password\":\"$2\"}"; }
me()      { http GET /auth/me "" "access_token=$1"; }
refresh() { http POST /auth/refresh "" "refresh_token=$1"; }

# ---------- identities & fixtures ----------
# new_identity: sets EMAIL/PHONE and registers EMAIL for cleanup.
# Call directly, never in $(...) — a subshell would lose the registration.
new_identity() {
  EMAIL="sectest+$(date +%s%N | tail -c 8)${RANDOM}@fra.test"
  PHONE="+2507$(( RANDOM % 9 + 1 ))$(printf '%07d' $(( (RANDOM * 32768 + RANDOM) % 10000000 )))"
  CREATED_EMAILS+=("$EMAIL")
}
signup_json() { # [password] [extra JSON fields, e.g. ,"role":"admin"]
  printf '{"email":"%s","phoneNumber":"%s","firstName":"Sec","lastName":"Test","password":"%s"%s}' \
    "$EMAIL" "$PHONE" "${1:-$FIXTURE_PASSWORD}" "${2:-}"
}

# create_user: inserts a customer straight into the DB (password =
# $FIXTURE_PASSWORD). Sets USER_ID, EMAIL, PHONE.
create_user() {
  new_identity
  USER_ID=$(sql "INSERT INTO users (email, phone_number, first_name, last_name, password_hash, role)
                 VALUES ('$EMAIL', '$PHONE', 'Sec', 'Test', '$FIXTURE_HASH', 'customer') RETURNING id;")
  [[ -z "$USER_ID" ]] && harness_error "could not create fixture user"
}

rand_token() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'; }
sha()        { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

# mint_session USER_ID [access_expiry_sql] [refresh_expiry_sql]
# Writes a session straight into the DB the way the server would (only
# SHA-256 hashes stored). Sets ACCESS, REFRESH, FAMILY.
mint_session() {
  local uid=$1
  local a_exp=${2:-"now() + interval '15 minutes'"} r_exp=${3:-"now() + interval '30 days'"}
  ACCESS=$(rand_token); REFRESH=$(rand_token)
  FAMILY=$(sql "WITH f AS (SELECT gen_random_uuid() AS id),
      r AS (INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
            SELECT '$uid', '$(sha "$REFRESH")', id, $r_exp FROM f),
      a AS (INSERT INTO access_sessions (user_id, token_hash, family_id, expires_at)
            SELECT '$uid', '$(sha "$ACCESS")', id, $a_exp FROM f)
    SELECT id FROM f;")
}

# ---------- cleanup ----------
cleanup() {
  local rc=$? list="" e
  for e in "${CREATED_EMAILS[@]}"; do list+="'$e',"; done
  if [[ -n "$list" ]]; then
    # Hard delete; refresh_tokens / access_sessions go with it (ON DELETE CASCADE).
    sql "DELETE FROM users WHERE email IN (${list%,});" >/dev/null \
      || printf '  WARN cleanup failed for %s\n' "${list%,}" >&2
  fi
  rm -rf "$TMP"
  # A test that exits 0 without reaching `finish` stopped early (e.g. a
  # file truncated while copying) -- that must not count as a PASS.
  if [[ $rc == 0 && $FINISHED != 1 ]]; then
    printf '  \033[35mERROR\033[0m test ended without reaching finish (truncated file?)\n'
    exit 3
  fi
}
trap cleanup EXIT

# Fail fast if the stack isn't reachable, rather than reporting 20 FAILs.
curl -s -o /dev/null --max-time 5 "$BASE/health" || harness_error "API not reachable at $BASE/health"