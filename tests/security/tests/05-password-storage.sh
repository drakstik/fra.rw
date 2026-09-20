#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
principle "Passwords are stored only as salted Argon2id hashes and never leave the server"

PW='Unique-Canary-Pw-'"$RANDOM$RANDOM"
new_identity; E1=$EMAIL
http POST /auth/sign-up "$(signup_json "$PW")"
expect_status 201 "sign-up with a canary password"
session_cookies; A=$ACCESS
for needle in "$PW" password Password argon2; do
  expect_absent "$BODY" "$needle" "sign-up response has no '$needle'"
done

H1=$(sql "SELECT password_hash FROM users WHERE email = '$E1'")
[[ "$H1" == '$argon2id$'* ]]; ok $? "DB: stored as an Argon2id PHC string" "$H1"
expect_absent "$H1" "$PW" "DB: hash does not contain the plaintext"
[[ "$H1" =~ m=([0-9]+),t=([0-9]+) ]] \
  && (( BASH_REMATCH[1] >= 19456 && BASH_REMATCH[2] >= 2 )); ok $? "DB: cost >= OWASP minimum (m=19456 KiB, t=2)" "$H1"

new_identity
http POST /auth/sign-up "$(signup_json "$PW")"
expect_status 201 "second user with the SAME password"
H2=$(sql "SELECT password_hash FROM users WHERE email = '$EMAIL'")
expect_ne "$H1" "$H2" "same password -> different hashes (unique salt per user)"

me "$A"
expect_status 200 "/me works"
for needle in password Password argon2 hash; do expect_absent "$BODY" "$needle" "/me response has no '$needle'"; done

# Login loads the hash (addSelect) -- the riskiest path for leaking it.
login "$E1" "$PW"
expect_status 200 "login works"
for needle in password Password argon2 hash; do expect_absent "$BODY" "$needle" "login response has no '$needle'"; done

finish