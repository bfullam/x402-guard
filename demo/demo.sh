#!/usr/bin/env bash
# x402-guard demo: one payment goes through, one is refused, one is held for a human.
#
# Needs: mm logged in (Guard Mode), the plugin installed (see plugin/README.md),
# INTERCEPTA_API_KEY in the environment or ./.env, and test USDC on Base Sepolia (faucet.circle.com).
# Payments run on Base Sepolia and the one that passes is settled for real through the public x402
# facilitator. Payees are real mainnet addresses, screened with Intercepta's mainnet risk data.
set -uo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; . ./.env; set +a; }
PORT="${PORT:-4021}"
SELLER="http://127.0.0.1:$PORT"
NET="${NET:-base-sepolia}"

python3 demo/seller.py --port "$PORT" --settle > /dev/null 2>&1 &
SELLER_PID=$!
trap 'kill $SELLER_PID 2>/dev/null' EXIT
sleep 1

step() { printf '\n\033[1m━━ %s\033[0m\n' "$1"; [ -n "${FAST:-}" ] || read -rp "(enter) " _; }

step "1/3  An agent buys data from a clean seller"
mm x402 pay "$SELLER/s/clean?net=$NET"

step "2/3  The seller's payTo is an OFAC-sanctioned wallet (Lazarus Group)"
mm x402 pay "$SELLER/s/sanctioned?net=$NET"

step "3/3  \$0.50 to a wallet that has used Tornado Cash: above the caution ceiling, so a human decides"
mm x402 pay "$SELLER/s/mixer-wallet?net=$NET&amount=0.5"

printf '\nIn an agent session the agent now shows these reasons and asks you.\n'
printf 'If you agree, it reruns the payment with --approve <code>.\n'
