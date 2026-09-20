#!/usr/bin/env bash
# Runs the auth security suite in priority order.
#
#   tests/security/run-all.sh                  # all tests, 13 (destructive) last
#   tests/security/run-all.sh --safe           # skip tests that exhaust rate limits
#   tests/security/run-all.sh 02 06            # only tests whose names start with 02 / 06
#
# Rate-limit budget: one full run uses ~9 of 10 sign-ups/hour and ~17 of
# 20 logins/15 min for your IP, and test 13 then exhausts the login budget.
# The limiter lives in the backend's memory, so a restart clears it. Set
# FRA_RESET_CMD to do that before the run, e.g. with the dev container's
# `tsx watch`:
#   FRA_RESET_CMD='touch apps/backend/src/index.ts && sleep 6' tests/security/run-all.sh
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/../.."   # repo root, so FRA_RESET_CMD paths are predictable

SAFE=0; FILTERS=()
for a in "$@"; do [[ "$a" == --safe ]] && SAFE=1 || FILTERS+=("$a"); done

if [[ -n "${FRA_RESET_CMD:-}" ]]; then
  echo "Resetting rate limits: $FRA_RESET_CMD"
  eval "$FRA_RESET_CMD" || { echo "reset command failed"; exit 3; }
fi

declare -a NAMES RESULTS
OUT=$(mktemp); trap 'rm -f "$OUT"' EXIT
for t in "$DIR"/tests/[0-9][0-9]-*.sh; do
  name=$(basename "$t" .sh)
  if (( ${#FILTERS[@]} )); then
    keep=0; for f in "${FILTERS[@]}"; do [[ "$name" == "$f"* ]] && keep=1; done
    (( keep )) || continue
  fi
  if (( SAFE )) && grep -q '^# DESTRUCTIVE' "$t"; then continue; fi
  bash "$t" 2>&1 | tee "$OUT"; rc=${PIPESTATUS[0]}
  # An empty or broken file exits 0 having checked nothing; don't call that a PASS.
  if [[ $rc == 0 ]] && ! grep -qE 'm(PASS|FAIL)' "$OUT"; then
    printf '\n[%s]\n  \033[35mERROR\033[0m ran no checks (empty or broken file?)\n' "$name"; rc=3
  fi
  NAMES+=("$name")
  case $rc in 0) RESULTS+=("PASS");; 1) RESULTS+=("FAIL");; 2) RESULTS+=("BLOCKED");; *) RESULTS+=("ERROR");; esac
done

# Belt and braces: remove any test user a crashed test failed to clean up.
# shellcheck source=/dev/null
( source "$DIR/lib.sh" >/dev/null 2>&1; trap - EXIT
  n=$(sql "WITH d AS (DELETE FROM users WHERE email LIKE 'sectest+%@fra.test' RETURNING 1) SELECT count(*) FROM d;")
  [[ "${n:-0}" != 0 ]] && echo "Swept $n leftover test user(s)." ; rm -rf "$TMP" )

echo; echo "================ SUMMARY ================"
code=0
for i in "${!NAMES[@]}"; do
  r=${RESULTS[$i]}
  case $r in PASS) c=32;; FAIL) c=31; code=1;; BLOCKED) c=33; [[ $code == 0 ]] && code=2;; *) c=35; code=3;; esac
  printf "  \033[${c}m%-8s\033[0m %s\n" "$r" "${NAMES[$i]}"
done
grep -q "BLOCKED" <<<"${RESULTS[*]:-}" && echo "  (BLOCKED = rate-limited; set FRA_RESET_CMD or wait out the window)"
exit $code