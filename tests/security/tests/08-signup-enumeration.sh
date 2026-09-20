#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
principle "Sign-up doesn't reveal WHICH identifier (email or phone) is already registered"

create_user; TAKEN_EMAIL=$EMAIL; TAKEN_PHONE=$PHONE

new_identity; EMAIL=$TAKEN_EMAIL
http POST /auth/sign-up "$(signup_json)"; S1=$STATUS; B1=$BODY
expect_status 409 "taken email + fresh phone is refused"

new_identity; PHONE=$TAKEN_PHONE
http POST /auth/sign-up "$(signup_json)"; S2=$STATUS; B2=$BODY
expect_status 409 "fresh email + taken phone is refused"
expect_eq "$B2" "$B1" "byte-identical body either way (no 'email taken' vs 'phone taken')"

new_identity; EMAIL=$(tr '[:lower:]' '[:upper:]' <<<"$TAKEN_EMAIL")
http POST /auth/sign-up "$(signup_json)"
expect_status 409 "ATTACK: same email in UPPERCASE is still the same account"
expect_eq "$BODY" "$B1" "...with the same generic body"

expect_eq "$(sql "SELECT count(*) FROM users WHERE email = '$TAKEN_EMAIL' OR phone_number = '$TAKEN_PHONE'")" 1 \
  "DB: no duplicate account was created"

finish