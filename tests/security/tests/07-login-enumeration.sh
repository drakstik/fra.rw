#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
principle "Login doesn't reveal whether an email is registered (by response or by timing)"

create_user; REAL=$EMAIL
BAD='Wrong-Password-000'
new_identity; GHOST=$EMAIL   # never created (new_identity overwrites $EMAIL, hence REAL)

# Alternate the two cases so drift in server load hits both equally.
REAL_T=(); GHOST_T=()
for i in 1 2; do
  login "$REAL" "$BAD"; REAL_S=$STATUS; REAL_B=$BODY; REAL_T+=("$TIME")
  login "$GHOST" "$BAD"; GHOST_S=$STATUS; GHOST_B=$BODY; GHOST_T+=("$TIME")
done
expect_eq "$GHOST_S" "$REAL_S" "same status for unknown email and wrong password ($REAL_S)"
expect_eq "$GHOST_B" "$REAL_B" "byte-identical body for unknown email and wrong password"

# Fastest of each, to drop scheduling noise. Unknown-email login must still
# burn an Argon2 computation, so both should be the same order of magnitude.
min() { printf '%s\n' "$@" | sort -n | head -1; }
R=$(min "${REAL_T[@]}"); G=$(min "${GHOST_T[@]}")
RATIO=$(awk -v r="$R" -v g="$G" 'BEGIN { printf "%.2f", (r > g ? r / g : g / r) }')
awk -v x="$RATIO" 'BEGIN { exit !(x < 3) }'; ok $? "timing: real ${R}s vs unknown ${G}s (ratio ${RATIO}x, must be < 3x)"

finish