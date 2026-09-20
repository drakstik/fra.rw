#!/usr/bin/env bash
# DESTRUCTIVE: exhausts this IP's login budget for 15 minutes. Run last.
source "$(dirname "$0")/../lib.sh"
principle "Per-IP login rate limit holds, and can't be dodged by spoofing X-Forwarded-For"

ALLOW_429=1
new_identity    # never created: every attempt is an unknown-email failure
HIT=0
for i in $(seq 1 25); do
  FAKE="$((RANDOM % 223 + 1)).$((RANDOM % 256)).$((RANDOM % 256)).$((RANDOM % 256))"
  http POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"x-$i\"}" "" \
    -H "X-Forwarded-For: $FAKE" -H "X-Real-IP: $FAKE"
  if [[ "$STATUS" == 429 ]]; then HIT=$i; break; fi
done
[[ "$HIT" -gt 0 ]]; ok $? "ATTACK: rotating spoofed X-Forwarded-For still hits 429 (at attempt ${HIT:-never})"
[[ "$HIT" -gt 0 && "$HIT" -le 21 ]]; ok $? "limit triggers within the 20-per-window budget"
expect_code RATE_LIMITED "429 uses the RATE_LIMITED code"
grep -qiE '^ratelimit(-policy)?:' "$TMP/headers"; ok $? "standard RateLimit headers present"

http POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"x\"}" "" -H "X-Forwarded-For: 10.$RANDOM.1.1"
expect_status 429 "a fresh spoofed IP after the block is still blocked"

finish