#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
principle "Sign-up can't be used to choose privileged or server-owned fields"

new_identity
FORGED_ID='00000000-0000-4000-8000-000000000001'
EXTRA=',"role":"admin","id":"'$FORGED_ID'","isActive":true,"emailVerifiedAt":"2020-01-01T00:00:00Z"'
EXTRA+=',"failedLoginAttempts":-1000,"tokenVersion":99,"passwordHash":"x","__proto__":{"role":"admin"}'
EXTRA+=',"constructor":{"prototype":{"role":"admin"}}'
http POST /auth/sign-up "$(signup_json "$FIXTURE_PASSWORD" "$EXTRA")"

if [[ "$STATUS" == 400 ]]; then
  pass "extra fields rejected outright (strict schema)"
else
  expect_status 201 "sign-up with injected fields is accepted only with them stripped"
  expect_absent "$BODY" '"role":"admin"' "response role is not admin"
  ROW=$(sql "SELECT role, id::text, email_verified_at IS NULL, failed_login_attempts, token_version,
                    password_hash LIKE '\$argon2id\$%' FROM users WHERE email = '$EMAIL'")
  IFS='|' read -r ROLE ID UNVERIFIED FAILS_DB TV ARGON <<<"$ROW"
  expect_eq "$ROLE" customer           "DB: role is customer, not admin"
  expect_ne "$ID" "$FORGED_ID"         "DB: id is server-generated"
  expect_eq "$UNVERIFIED" t            "DB: email not marked verified"
  expect_eq "$FAILS_DB" 0              "DB: failed_login_attempts not client-controlled"
  expect_eq "$TV" 0                    "DB: token_version not client-controlled"
  expect_eq "$ARGON" t                 "DB: password_hash came from hashing, not the request"
fi
expect_eq "$(sql "SELECT count(*) FROM users WHERE id = '$FORGED_ID' OR (email = '$EMAIL' AND role <> 'customer')")" 0 \
  "DB: no admin/forged-id user exists"

finish