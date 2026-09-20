#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
principle "Every request's access token is validated against the DB; nothing else is accepted"

create_user
mint_session "$USER_ID"; A=$ACCESS; R=$REFRESH
me "$A"; expect_status 200 "control: a valid session is accepted"

http GET /auth/me;                      expect_status 401 "no cookie -> 401"
me "$(rand_token)";                     expect_status 401 "ATTACK: random well-formed token -> 401"
me "$(sha "$A")";                       expect_status 401 "ATTACK: stolen DB hash used as the token -> 401 (DB leak can't mint sessions)"
me "$R";                                expect_status 401 "ATTACK: refresh token used as access token -> 401"
refresh "$A";                           expect_status 401 "ATTACK: access token used as refresh token -> 401"
me "' OR '1'='1";                       expect_status 401 "ATTACK: SQL-injection-shaped token -> 401"
me "$A$A";                              expect_status 401 "ATTACK: valid token with padding -> 401"
http GET /auth/me "" "access_token=$A" -H "Authorization: Bearer $(rand_token)"
expect_status 200 "an Authorization header is ignored, not a second way in"

mint_session "$USER_ID" "now() - interval '1 second'"
me "$ACCESS"; expect_status 401 "expired access session -> 401 even if the cookie is still sent"

mint_session "$USER_ID"; A2=$ACCESS
sql "DELETE FROM access_sessions WHERE token_hash = '$(sha "$A2")'" >/dev/null
me "$A2"; expect_status 401 "deleting the row revokes instantly (no TTL grace)"

mint_session "$USER_ID" "now() + interval '15 minutes'" "now() - interval '1 second'"
refresh "$REFRESH"; expect_status 401 "expired refresh token -> 401"

# Account state is re-checked on every request, not only at login.
mint_session "$USER_ID"; A3=$ACCESS; R3=$REFRESH
sql "UPDATE users SET is_active = false WHERE id = '$USER_ID'" >/dev/null
me "$A3";      expect_status 401 "deactivated user: live access token stops working"
refresh "$R3"; expect_status 401 "deactivated user: live refresh token stops working"
login "$EMAIL" "$FIXTURE_PASSWORD"
expect_status 403 "deactivated user cannot log in"

sql "UPDATE users SET is_active = true, deleted_at = now() WHERE id = '$USER_ID'" >/dev/null
mint_session "$USER_ID"
me "$ACCESS";      expect_status 401 "soft-deleted user: live access token stops working"
refresh "$REFRESH"; expect_status 401 "soft-deleted user: live refresh token stops working"

finish