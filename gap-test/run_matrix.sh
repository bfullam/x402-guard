#!/usr/bin/env bash
# Run every seller scenario through MetaMask's own x402 helper (vendor/x402_pay.py,
# which signs via `mm wallet sign-typed-data`) and record whether the wallet signed.
#
#   ./run_matrix.sh                      # all scenarios on base + base-sepolia
#   ./run_matrix.sh sanctioned base      # one scenario / network
#
# Needs demo/seller.py running (default http://127.0.0.1:4020). If a 2FA approval
# arrives on your phone/email, note it and REJECT it; that counts as "held".
set -uo pipefail
cd "$(dirname "$0")"

SELLER="${SELLER:-http://127.0.0.1:4020}"
TIMEOUT="${TIMEOUT:-240}"
SCENARIOS=("${1:-clean sanctioned fake-usdc big long-lived}")
NETS=("${2:-base base-sepolia}")
LOG="results/matrix_$(date +%Y%m%d_%H%M%S).log"
mkdir -p results

tmo() { if command -v gtimeout >/dev/null; then gtimeout "$@"; elif command -v timeout >/dev/null; then timeout "$@"; else shift; "$@"; fi; }

printf '%-11s %-13s %-8s %s\n' SCENARIO NETWORK RESULT DETAIL | tee "$LOG"
for net in ${NETS[*]}; do
  for s in ${SCENARIOS[*]}; do
    url="$SELLER/s/$s?net=$net${AMOUNT:+&amount=$AMOUNT}"
    out=$(tmo "$TIMEOUT" python3 vendor/x402_pay.py pay "$url" --confirm 2>&1)
    code=$?
    echo "=== $s $net (exit $code)" >>"${LOG%.log}.raw.log"
    echo "$out" >>"${LOG%.log}.raw.log"
    if echo "$out" | grep -q '"status": "settled"'; then
      result=SIGNED; detail="wallet signed the authorization"
    elif [ $code -eq 124 ]; then
      result=TIMEOUT; detail="no answer in ${TIMEOUT}s (awaiting 2FA?)"
    else
      result=STOPPED; detail=$(echo "$out" | tr '\n' ' ' | cut -c1-160)
    fi
    printf '%-11s %-13s %-8s %s\n' "$s" "$net" "$result" "$detail" | tee -a "$LOG"
  done
done
echo; echo "Summary: $LOG   Raw output: ${LOG%.log}.raw.log   Captured signatures: demo/results/*.json"
