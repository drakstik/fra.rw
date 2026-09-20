#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
principle "Hostile input is rejected as a client error, and errors never leak internals"

leaks() { [[ "$1" == *SyntaxError* || "$1" == *"    at "* || "$1" == *node_modules* || "$1" == *QueryFailedError* || "$1" == *"violates"* ]]; }
no_leak() { if leaks "$BODY"; then fail "$1: response leaks internals" "$BODY"; else pass "$1: no internals leaked"; fi; }

http POST /auth/login '{"email": '
no_leak "malformed JSON"
expect_status 400 "malformed JSON is a 400, not a 500"

BIG=$(head -c 40000 /dev/zero | tr '\0' a)
http POST /auth/login "{\"email\":\"$BIG\"}"
no_leak "40 KB body (limit 32 KB)"
expect_status 413 "oversized body is a 413, not a 500"

http POST /auth/login '{"email":{"$ne":null},"password":{"$gt":""}}'
expect_status 400 "ATTACK: operator objects instead of strings -> 400"
http POST /auth/login "{\"email\":\"' OR 1=1 --\",\"password\":\"x\"}"
expect_status 400 "ATTACK: SQL-injection email -> 400"
http POST /auth/login '{"email":"a\u0000@x.com","password":"x"}'
expect_status 400 "ATTACK: NUL byte in email -> 400"; no_leak "NUL byte"

LONG=$(head -c 10000 /dev/zero | tr '\0' p)
http POST /auth/login "{\"email\":\"nobody@fra.test\",\"password\":\"$LONG\"}"
expect_status 400 "ATTACK: 10,000-char password rejected before hashing (hash-DoS cap)"
awk -v t="$TIME" 'BEGIN { exit !(t < 0.5) }'; ok $? "...and quickly (${TIME}s), so no Argon2 work was done"

finish