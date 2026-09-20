#!/usr/bin/env bash

# This tests your core "opaque, not JWT" decision:

# - Tokens are 256-bit random values with nothing to decode.
# - They are never echoed in response bodies.
# - The DB holds only their SHA-256 hashes. It scans every column of the three auth tables for the raw values.
# - Both halves of the session share one family, which is what lets theft detection kill both.

# It uses a real sign-up, because issuance is the logic under test.

source "$(dirname "$0")/../lib.sh"
principle "Session tokens are opaque random values; only their SHA-256 hashes are stored"

new_identity
http POST /auth/sign-up "$(signup_json)"
expect_status 201 "sign-up issues a session"
session_cookies

# Opaque: 32 random bytes, base64url -> exactly 43 chars, no structure to decode.
[[ "$ACCESS" =~ ^[A-Za-z0-9_-]{43}$ ]]; ok $? "access token is 43-char base64url (256-bit random)"
[[ "$REFRESH" =~ ^[A-Za-z0-9_-]{43}$ ]]; ok $? "refresh token is 43-char base64url (256-bit random)"
[[ "$ACCESS" != *.*.* ]]; ok $? "access token is not a JWT (no header.payload.signature)"
expect_ne "$ACCESS" "$REFRESH" "access and refresh tokens are independent values"
expect_absent "$BODY" "$ACCESS"  "access token is not echoed in the response body"
expect_absent "$BODY" "$REFRESH" "refresh token is not echoed in the response body"

# At rest: the DB holds sha256(raw), never raw.
expect_eq "$(sql "SELECT count(*) FROM access_sessions WHERE token_hash = '$(sha "$ACCESS")'")" 1 \
  "access_sessions stores sha256(access token)"
expect_eq "$(sql "SELECT count(*) FROM refresh_tokens WHERE token_hash = '$(sha "$REFRESH")'")" 1 \
  "refresh_tokens stores sha256(refresh token)"
for t in access_sessions refresh_tokens users; do
  expect_eq "$(sql "SELECT count(*) FROM $t x WHERE strpos(x::text, '$ACCESS') > 0 OR strpos(x::text, '$REFRESH') > 0")" 0 \
    "no raw token anywhere in $t"
done

# Both halves of the session share one family (what lets theft detection kill both).
expect_eq "$(sql "SELECT count(DISTINCT family_id) FROM (
    SELECT family_id FROM access_sessions WHERE token_hash = '$(sha "$ACCESS")'
    UNION ALL SELECT family_id FROM refresh_tokens WHERE token_hash = '$(sha "$REFRESH")') f")" 1 \
  "access and refresh rows share one familyId"

finish