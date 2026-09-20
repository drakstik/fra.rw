#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
principle "Repeated failed logins lock the account; the correct password doesn't bypass the lock"

create_user
BAD='Wrong-Password-000'
st() { sql "SELECT failed_login_attempts || '|' || coalesce((locked_until > now())::text, 'null') FROM users WHERE id = '$USER_ID'"; }

login "$EMAIL" "$BAD"
expect_status 401 "a wrong password is rejected"
expect_eq "$(st)" "1|null" "DB: failure counted, not locked yet"

# Grey-box fast-forward to the edge of the threshold (10) instead of
# spending 9 more requests of the per-IP login budget.
sql "UPDATE users SET failed_login_attempts = 9 WHERE id = '$USER_ID'" >/dev/null
login "$EMAIL" "$BAD"
expect_status 401 "10th failure is still a plain 401"
expect_eq "$(st)" "10|true" "DB: 10th failure locks the account"
MINS=$(sql "SELECT round(extract(epoch FROM locked_until - now()) / 60) FROM users WHERE id = '$USER_ID'")
[[ "$MINS" -ge 14 && "$MINS" -le 15 ]]; ok $? "DB: lock lasts ~15 minutes (got ${MINS}m)"

login "$EMAIL" "$FIXTURE_PASSWORD"
expect_status 423 "ATTACK: the CORRECT password is refused while locked"
expect_code ACCOUNT_LOCKED "locked response uses ACCOUNT_LOCKED"
check "no session cookie issued while locked" [ -z "$(cookie_val access_token)" ]
expect_eq "$(st)" "10|true" "DB: attempts during the lock don't reset it"

sql "UPDATE users SET locked_until = now() - interval '1 second' WHERE id = '$USER_ID'" >/dev/null
login "$EMAIL" "$FIXTURE_PASSWORD"
expect_status 200 "after the lock expires, the correct password works"
expect_eq "$(st)" "0|null" "DB: success resets the counter and the lock"

finish