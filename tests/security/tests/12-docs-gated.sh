#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
principle "The live Swagger UI is behind Basic Auth (and absent in production)"

if [[ "$(env_get NODE_ENV)" == production ]]; then
  http GET /docs/; expect_status 404 "production: /docs does not exist"; finish
fi
U=$(env_get SWAGGER_DOCS_USER); P=$(env_get SWAGGER_DOCS_PASSWORD)

http GET /docs/
expect_status 401 "no credentials -> 401"
grep -qi '^www-authenticate: basic' "$TMP/headers"; ok $? "401 carries a Basic challenge"
expect_absent "$BODY" "swagger" "401 body leaks no Swagger content"

http GET /docs/ "" "" -u "$U:wrong-$RANDOM"
expect_status 401 "ATTACK: right user, wrong password -> 401"
http GET /docs/ "" "" -u "admin:admin"
expect_status 401 "ATTACK: default admin:admin -> 401"

if [[ -z "$U" || -z "$P" ]]; then
  skip "correct-credentials check (SWAGGER_DOCS_USER/PASSWORD not readable from .env)"
else
  http GET /docs/ "" "" -u "$U:$P"
  expect_status 200 "correct credentials -> 200"
  # Authenticated, so the 301 isn't pre-empted by the 401. A Location that
  # dropped /api would send the browser to the SPA instead of the docs.
  http GET /docs "" "" -u "$U:$P"
  LOC=$(grep -i '^location:' "$TMP/headers" | tr -d '\r' | awk '{print $2}')
  [[ "$LOC" == */api/docs/ ]]; ok $? "redirect keeps the /api prefix (got '${LOC:-none}')"
fi
finish