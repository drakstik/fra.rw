#!/usr/bin/env bash

# This test plays out the attack in steps:

# The victim rotates their refresh token normally.
# The attacker replays the old token and is rejected.
# Replaying it also kills the victim's live refresh and access tokens immediately, not at TTL.

# It checks that the DB agrees and that the step-2 security event was logged without the raw token. 
# The final section is the grey-box race attack: 10 parallel refreshes with one token. This currently fails; see Findings.
source "$(dirname "$0")/../lib.sh"
principle "Refresh tokens are single-use; replaying a rotated token kills the whole session"

create_user
login "$EMAIL" "$FIXTURE_PASSWORD"
expect_status 200 "victim logs in"
session_cookies; A0=$ACCESS; R0=$REFRESH
FAMILY=$(sql "SELECT family_id FROM refresh_tokens WHERE token_hash = '$(sha "$R0")'")

# --- legitimate rotation ---
refresh "$R0"
expect_status 200 "victim refreshes (R0 -> R1)"
session_cookies; A1=$ACCESS; R1=$REFRESH
expect_ne "$R1" "$R0" "rotation issues a new refresh token"
expect_ne "$A1" "$A0" "rotation issues a new access token"
expect_eq "$(sql "SELECT (revoked_at IS NOT NULL) || ':' || (replaced_by_token_hash = '$(sha "$R1")')
                  FROM refresh_tokens WHERE token_hash = '$(sha "$R0")'")" "true:true" \
  "DB: R0 revoked and linked to its successor R1"
me "$A0"; expect_status 401 "old access token A0 dies at rotation (strict revocation)"
me "$A1"; expect_status 200 "new access token A1 works"

# --- attack: replay the rotated token ---
refresh "$R0"
expect_status 401 "ATTACK: replaying rotated R0 is rejected"
expect_code INVALID_REFRESH_TOKEN "rejection uses the generic INVALID_REFRESH_TOKEN code"
check "rejection clears the refresh cookie" cookie_cleared refresh_token

refresh "$R1"; expect_status 401 "fallout: victim's live R1 is revoked too (whole family)"
me "$A1";      expect_status 401 "fallout: victim's live A1 dies immediately, not at TTL"
expect_eq "$(sql "SELECT count(*) FROM refresh_tokens WHERE family_id = '$FAMILY' AND revoked_at IS NULL")" 0 \
  "DB: no unrevoked refresh token left in the family"
expect_eq "$(sql "SELECT count(*) FROM access_sessions WHERE family_id = '$FAMILY'")" 0 \
  "DB: no access session left in the family"

# --- grey-box: the replay was logged as a security event ---
LOGS=$(backend_logs || true)
if [[ -z "$LOGS" ]]; then
  skip "security_event log check (no logs available; set FRA_LOGS_CMD)"
else
  EVENT=$(grep '"security_event":"refresh_token_family_revoked"' <<<"$LOGS" | grep "$FAMILY" | grep '"reason":"reused"')
  [[ -n "$EVENT" ]]; ok $? "replay logged as refresh_token_family_revoked / reused"
  [[ "$EVENT" == *'"level":"warn"'* ]]; ok $? "log line is level warn"
  expect_absent "$(grep "$FAMILY" <<<"$LOGS")" "$R0" "log never contains the raw token"
fi

# --- attack: race one token (every request reads it before any revokes it) ---
# 2 rounds x 10 parallel requests, fresh session each round. Uses 20 of
# the 60-per-15-min refresh budget.
WINNERS=""; WORST_LIVE=0
for round in 1 2; do
  mint_session "$USER_ID"
  rm -f "$TMP"/race.*
  for i in $(seq 1 10); do
    curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Cookie: refresh_token=$REFRESH" \
      "$BASE/auth/refresh" > "$TMP/race.$i" &
  done
  wait
  grep -q '^429$' "$TMP"/race.* && blocked "rate-limited during race test"
  OKS=$(cat "$TMP"/race.* | grep -c '^200$')
  LIVE=$(sql "SELECT count(*) FROM refresh_tokens WHERE family_id = '$FAMILY' AND revoked_at IS NULL")
  WINNERS+="$OKS "
  (( LIVE > WORST_LIVE )) && WORST_LIVE=$LIVE
done
[[ "$WINNERS" == "1 1 " ]]; ok $? "ATTACK: 10 parallel refreshes with one token -> exactly one succeeds per round (got: ${WINNERS% })"[[ "$WORST_LIVE" -le 1 ]]; ok $? "DB: race leaves at most one live refresh token per family (worst: $WORST_LIVE)"

finish