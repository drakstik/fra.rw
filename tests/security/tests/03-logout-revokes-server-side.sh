#!/usr/bin/env bash

# Clearing cookies in the browser isn't logout; 
# an attacker who copied them must be locked out too. This test replays the copied cookies after logout and checks the DB rows. 
# It confirms logout is per-session: a second device, minted in the DB, survives.
# It also checks that logout isn't an oracle. It returns the same 204 whether the token is missing, garbage, or already revoked.
source "$(dirname "$0")/../lib.sh"
principle "Logout revokes the session on the server, not just in the browser"

create_user
login "$EMAIL" "$FIXTURE_PASSWORD"
expect_status 200 "user logs in (session S1)"
session_cookies; S1_A=$ACCESS; S1_R=$REFRESH
S1_FAMILY=$(sql "SELECT family_id FROM refresh_tokens WHERE token_hash = '$(sha "$S1_R")'")
mint_session "$USER_ID"; S2_A=$ACCESS            # a second device, minted in the DB

http POST /auth/logout "" "refresh_token=$S1_R"
expect_status 204 "logout succeeds"
check "logout clears the access cookie"  cookie_cleared access_token
check "logout clears the refresh cookie" cookie_cleared refresh_token

# Attacker kept copies of the cookies: they must be dead server-side.
me "$S1_A";      expect_status 401 "ATTACK: replaying S1's access token after logout fails"
refresh "$S1_R"; expect_status 401 "ATTACK: replaying S1's refresh token after logout fails"
expect_eq "$(sql "SELECT count(*) FROM refresh_tokens WHERE family_id = '$S1_FAMILY' AND revoked_at IS NULL")" 0 \
  "DB: S1's refresh tokens are revoked"
expect_eq "$(sql "SELECT count(*) FROM access_sessions WHERE family_id = '$S1_FAMILY'")" 0 \
  "DB: S1's access session is deleted"

me "$S2_A"; expect_status 200 "logout is per-session: the other device's session survives"

# Logout must not be an oracle: same answer with no/garbage/already-dead tokens.
http POST /auth/logout "";                            expect_status 204 "logout without a cookie -> 204"
http POST /auth/logout "" "refresh_token=$(rand_token)"; expect_status 204 "logout with a garbage token -> 204"
http POST /auth/logout "" "refresh_token=$S1_R";      expect_status 204 "logout with an already-revoked token -> 204"

finish