#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
principle "Session cookies are HttpOnly, SameSite=Lax and scoped; refresh cookie only reaches /api/auth"

create_user
login "$EMAIL" "$FIXTURE_PASSWORD"
expect_status 200 "login"
AL=$(set_cookie_line access_token); RL=$(set_cookie_line refresh_token)
has() { [[ "${1,,}" == *"${2,,}"* ]]; }

for pair in "access_token|$AL" "refresh_token|$RL"; do
  name=${pair%%|*}; line=${pair#*|}
  check "$name: HttpOnly (JS/XSS can't read it)"       has "$line" "HttpOnly"
  check "$name: SameSite=Lax (CSRF baseline)"          has "$line" "SameSite=Lax"
  if [[ "${FRA_EXPECT_SECURE:-0}" == 1 ]]; then
    check "$name: Secure (HTTPS only)"                 has "$line" "; Secure"
  else
    skip "$name: Secure flag (dev over HTTP; set FRA_EXPECT_SECURE=1 once TLS is on)"
  fi
done
check "access_token: Path=/"                                   has "$AL" "Path=/;"
check "access_token: Max-Age=900 (15 min)"                     has "$AL" "Max-Age=900"
check "refresh_token: Path=/api/auth (nginx rewrote /auth)"    has "$RL" "Path=/api/auth"
check "refresh_token: Max-Age=2592000 (30 days)"               has "$RL" "Max-Age=2592000"

# Behavioural: use a real cookie jar and look at what curl actually sends.
JAR="$TMP/jar"
curl -s -o /dev/null -c "$JAR" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$FIXTURE_PASSWORD\"}" "$BASE/auth/login"
SENT_HEALTH=$(curl -s -v -o /dev/null -b "$JAR" "$BASE/health" 2>&1 | grep -i '^> cookie:' || true)
[[ "$SENT_HEALTH" == *access_token=* ]]; ok $? "browser-like client sends access_token to other /api routes"
[[ "$SENT_HEALTH" != *refresh_token=* ]]; ok $? "browser-like client does NOT send refresh_token outside /api/auth"
SENT_REFRESH=$(curl -s -v -o /dev/null -b "$JAR" -c "$JAR" -X POST "$BASE/auth/refresh" 2>&1)
[[ "$SENT_REFRESH" == *"refresh_token="* && "$SENT_REFRESH" == *"< HTTP/1.1 200"* ]]
ok $? "refresh works end-to-end with cookie-jar scoping through nginx"

finish