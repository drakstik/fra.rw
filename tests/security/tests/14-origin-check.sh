#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
principle "State-changing requests must come from a trusted origin (CSRF defense-in-depth)"

# The origin the app is actually served from, derived from FRA_BASE.
GOOD="${BASE%/api}"
EVIL="https://evil.example"
# Blocked requests are rejected before the routers, so they cost no
# rate-limit budget -- that's why this test can attack so many endpoints.

create_user

# Allowed-path checks use /auth/refresh and /auth/logout rather than
# /auth/login: they exercise the same middleware but draw on the 60-per-
# 15-min refresh budget instead of the 20-per-15-min login budget, which
# the earlier tests have nearly used up by the time this one runs.
mint_session "$USER_ID"
http POST /auth/refresh "" "refresh_token=$REFRESH" -H "Origin: $GOOD"
expect_status 200 "control: refresh from the app's own origin works"

# --- attack: CSRF'd login (would let an attacker force their session on you) ---
http POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"$FIXTURE_PASSWORD\"}" "" -H "Origin: $EVIL"
expect_status 403 "ATTACK: login from an attacker's origin is blocked"
expect_code CROSS_ORIGIN_BLOCKED "blocked with CROSS_ORIGIN_BLOCKED"
check "no session cookie is issued to the attacker" [ -z "$(cookie_val access_token)" ]

# --- attack: lookalike origins must not squeak through ---
for bad in "null" "${GOOD}.evil.com" "https://${GOOD#http://}" "${GOOD%:*}:8081" "http://evil.com?x=$GOOD"; do
  http POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"$FIXTURE_PASSWORD\"}" "" -H "Origin: $bad"
  expect_status 403 "ATTACK: Origin '$bad' is blocked"
done

# --- Referer fallback (used only when Origin is absent) ---
http POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"$FIXTURE_PASSWORD\"}" "" -H "Referer: $EVIL/attack.html"
expect_status 403 "ATTACK: hostile Referer with no Origin is blocked"
mint_session "$USER_ID"
http POST /auth/refresh "" "refresh_token=$REFRESH" -H "Referer: $GOOD/account"
expect_status 200 "same-origin Referer with no Origin is allowed"

# --- policy: no Origin and no Referer = not a browser, allowed through ---
mint_session "$USER_ID"
http POST /auth/refresh "" "refresh_token=$REFRESH"
expect_status 200 "neither header (curl / server-to-server) is allowed by policy"

# --- attack: CSRF'd refresh must not rotate the victim's token ---
mint_session "$USER_ID"; V_R=$REFRESH; V_A=$ACCESS
http POST /auth/refresh "" "refresh_token=$V_R" -H "Origin: $EVIL"
expect_status 403 "ATTACK: cross-site refresh is blocked"
expect_eq "$(sql "SELECT count(*) FROM refresh_tokens WHERE token_hash = '$(sha "$V_R")' AND revoked_at IS NULL")" 1 \
  "DB: victim's refresh token was NOT rotated by the blocked request"

# --- attack: CSRF'd logout (forced logout / denial of service) ---
http POST /auth/logout "" "refresh_token=$V_R" -H "Origin: $EVIL"
expect_status 403 "ATTACK: cross-site logout is blocked"
me "$V_A"; expect_status 200 "victim's session survives the blocked logout"

# --- attack: CSRF'd sign-up (account spam under a victim's IP) ---
SAVED_EMAIL=$EMAIL SAVED_PHONE=$PHONE
new_identity
http POST /auth/sign-up "$(signup_json)" "" -H "Origin: $EVIL"
expect_status 403 "ATTACK: cross-site sign-up is blocked"
expect_eq "$(sql "SELECT count(*) FROM users WHERE email = '$EMAIL'")" 0 "DB: no account was created"
EMAIL=$SAVED_EMAIL PHONE=$SAVED_PHONE

# --- safe methods are untouched (they change no state) ---
http GET /auth/me "" "access_token=$V_A" -H "Origin: $EVIL"
expect_status 200 "GET /me with a hostile Origin is still served (safe method)"

# --- grey-box: blocks are logged, without leaking the session ---
LOGS=$(backend_logs || true)
if [[ -z "$LOGS" ]]; then
  skip "security_event log check (no logs available; set FRA_LOGS_CMD)"
else
  EVENT=$(grep '"security_event":"cross_origin_request_blocked"' <<<"$LOGS" | tail -1)
  [[ -n "$EVENT" ]]; ok $? "blocks are logged as cross_origin_request_blocked"
  [[ "$EVENT" == *"$EVIL"* ]]; ok $? "log records the offending origin"
  expect_absent "$(grep cross_origin_request_blocked <<<"$LOGS")" "$V_R" "log never contains the victim's token"
fi

finish