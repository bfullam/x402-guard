#!/usr/bin/env python3
"""Probe Intercepta with the gap-test counterparties to see what it flags."""

import json
import sys
import time

from client import InterceptaError, deep_scan_address, quick_scan_address, scan_message, scan_token

WALLET = "0x28d762c467793f25c9c69a0ac67ee91c99f33290"
ADDRESSES = {
    "clean (vitalik.eth)": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "mixer (Tornado router)": "0x722122dF12D4e14e13Ac3b6895a86e84145b6967",
    "sanctioned (Lazarus)": "0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
    "our agent wallet": WALLET,
}
TOKENS = {
    "real USDC (Base)": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "fake USDC (…2914)": "0x833589fcD6EdB6e08f4C7C32d4F71b54BdA02914",
}


def show(label, fn, *args):
    try:
        data, ms = fn(*args)
        print("\n### %s  (%d ms)\n%s" % (label, ms, json.dumps(data, indent=1)[:1500]))
    except InterceptaError as e:
        print("\n### %s  ERROR %s\n%s" % (label, e.status, e.body[:500]))
    time.sleep(0.3)


def x402_typed_data(pay_to, asset="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", value="2400000", ttl=300):
    now = int(time.time())
    return {
        "types": {
            "EIP712Domain": [{"name": "name", "type": "string"}, {"name": "version", "type": "string"},
                             {"name": "chainId", "type": "uint256"}, {"name": "verifyingContract", "type": "address"}],
            "TransferWithAuthorization": [{"name": n, "type": t} for n, t in [
                ("from", "address"), ("to", "address"), ("value", "uint256"), ("validAfter", "uint256"),
                ("validBefore", "uint256"), ("nonce", "bytes32")]],
        },
        "primaryType": "TransferWithAuthorization",
        "domain": {"name": "USD Coin", "version": "2", "chainId": 8453, "verifyingContract": asset},
        "message": {"from": WALLET, "to": pay_to, "value": value, "validAfter": str(now - 600),
                    "validBefore": str(now + ttl), "nonce": "0x" + "11" * 32},
    }


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "address"):
        for label, a in ADDRESSES.items():
            show("quick-scan  " + label, quick_scan_address, a)
            show("deep-scan   " + label, deep_scan_address, a)
    if which in ("all", "token"):
        for label, t in TOKENS.items():
            show("scan-token  " + label, scan_token, t, 8453)
    if which in ("all", "message"):
        show("scan-message x402 -> mixer", scan_message, WALLET, x402_typed_data(ADDRESSES["mixer (Tornado router)"]), 8453)
        show("scan-message x402 -> clean", scan_message, WALLET, x402_typed_data(ADDRESSES["clean (vitalik.eth)"]), 8453)
        show("scan-message x402 fake USDC, 1yr", scan_message, WALLET,
             x402_typed_data(ADDRESSES["clean (vitalik.eth)"], TOKENS["fake USDC (…2914)"], ttl=365 * 86400), 8453)
