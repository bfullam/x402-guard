#!/usr/bin/env python3
"""Adversarial x402 seller for probing what MetaMask Agent Wallet screens.

Serves x402 v2 challenges (PAYMENT-REQUIRED header) for a set of scenarios,
each a different kind of bad (or clean) payment request. When the client
retries with a PAYMENT-SIGNATURE, the signed authorization is logged to
results/ and a fake settlement is returned.

By default NOTHING IS SETTLED ON-CHAIN: the signature is captured only as proof that
the wallet was willing to sign. With --settle, base-sepolia payments are verified and
settled for real through the public x402 facilitator; mainnet payments never are.

    python3 demo/seller.py [--port 4020] [--settle]
    GET /s/<scenario>?net=base|base-sepolia[&amount=<USDC, e.g. 2.4>]
"""

import argparse
import base64
import json
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

RESULTS = Path(__file__).parent / "results"
FACILITATOR = "https://x402.org/facilitator"
SETTLE = False  # --settle: settle base-sepolia payments for real through the public facilitator

# Real Circle USDC per network, with the EIP-712 domain its contract uses.
NETWORKS = {
    "base": {
        "caip2": "eip155:8453",
        "usdc": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "domain": {"name": "USD Coin", "version": "2"},
    },
    "base-sepolia": {
        "caip2": "eip155:84532",
        "usdc": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        "domain": {"name": "USDC", "version": "2"},
    },
}

# OFAC SDN-listed, confirmed via the Chainalysis sanctions oracle on Ethereum
# mainnet (0x40C57923924B5c5c5455c48D93317139ADDaC8fb, isSanctioned == true).
SANCTIONED = "0x098B716B8Aaf21512996dC57EB0615e2383E2f96"  # Lazarus Group / Ronin bridge exploiter
# Tornado Cash router: delisted by OFAC in 2025 and NOT frozen by Circle, so a
# payment here really settles, while it is still a mixer (high AML risk).
MIXER = "0x722122dF12D4e14e13Ac3b6895a86e84145b6967"
# Clean control recipient: a fresh address with no history (vitalik.eth draws a RUG_PULL_RELATED
# false positive in Intercepta Scan Message, so it is a poor control).
CLEAN = "0x9942e8f64339145f93cdc6bcd93169745dc2cc39"
# EOA that deposited to Tornado Cash (8 mixer txs; Intercepta deep scan: mixer_transfers 15).
# Not sanctioned and not frozen by Circle, so a payment to it would settle.
MIXER_WALLET = "0x2072f325f0Bb7e06c1D7C933a10886f794D4CC99"
# Lookalike of Base USDC: last hex digit changed (…2913 -> …2914). Not a token.
FAKE_USDC = "0x833589fcD6EdB6e08f4C7C32d4F71b54BdA02914"

USDC = 10**6

# name -> (description, builder(net) -> accepts[0] overrides)
SCENARIOS = {
    "clean": (
        "Control: 0.01 real USDC to a clean address",
        lambda n: {"payTo": CLEAN, "amount": str(USDC // 100)},
    ),
    "sanctioned": (
        "0.01 real USDC to an OFAC-sanctioned address (Lazarus / Ronin exploiter)",
        lambda n: {"payTo": SANCTIONED, "amount": str(USDC // 100)},
    ),
    "mixer": (
        "0.01 real USDC to the Tornado Cash router (mixer, not frozen by Circle)",
        lambda n: {"payTo": MIXER, "amount": str(USDC // 100)},
    ),
    "mixer-wallet": (
        "0.01 real USDC to a wallet with Tornado Cash deposits (not frozen by Circle)",
        lambda n: {"payTo": MIXER_WALLET, "amount": str(USDC // 100)},
    ),
    "fake-usdc": (
        "0.01 of a lookalike 'USD Coin' contract (one hex digit off real USDC)",
        lambda n: {"payTo": CLEAN, "amount": str(USDC // 100), "asset": FAKE_USDC},
    ),
    "big": (
        "5,000 real USDC to a clean address (does the outflow limit apply to signatures?)",
        lambda n: {"payTo": CLEAN, "amount": str(5000 * USDC)},
    ),
    "long-lived": (
        "0.01 real USDC, authorization valid for 1 year (replayable-window risk)",
        lambda n: {"payTo": CLEAN, "amount": str(USDC // 100), "maxTimeoutSeconds": 365 * 86400},
    ),
}


def b64(obj):
    return base64.b64encode(json.dumps(obj).encode()).decode()


def challenge(scenario, net, url, amount=None):
    cfg = NETWORKS[net]
    desc, build = SCENARIOS[scenario]
    option = {
        "scheme": "exact",
        "network": cfg["caip2"],
        "asset": cfg["usdc"],
        "maxTimeoutSeconds": 300,
        "extra": dict(cfg["domain"]),
    }
    option.update(build(net))
    if amount is not None:
        option["amount"] = str(round(float(amount) * USDC))
    return {
        "x402Version": 2,
        "error": "payment required",
        "resource": {"url": url, "description": desc, "mimeType": "application/json"},
        "accepts": [option],
    }


def facilitator(path, body):
    req = urllib.request.Request(
        FACILITATOR + path, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "x402-guard-demo-seller/0.1"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        try:
            return json.loads(text)
        except ValueError:
            return {"isValid": False, "success": False, "invalidReason": "HTTP %s: %s" % (e.code, text[:200])}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body, headers=None):
        data = json.dumps(body, indent=2).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        parts = u.path.strip("/").split("/")
        if len(parts) != 2 or parts[0] != "s" or parts[1] not in SCENARIOS:
            return self._send(404, {"scenarios": {k: v[0] for k, v in SCENARIOS.items()}})
        scenario = parts[1]
        q = parse_qs(u.query)
        net = q.get("net", ["base"])[0]
        amount = q.get("amount", [None])[0]
        if net not in NETWORKS:
            return self._send(400, {"error": "net must be one of %s" % list(NETWORKS)})
        url = "http://%s%s" % (self.headers.get("Host"), self.path)

        paid = self.headers.get("PAYMENT-SIGNATURE")
        if not paid:
            pr = challenge(scenario, net, url, amount)
            return self._send(402, pr, {"PAYMENT-REQUIRED": b64(pr)})

        payment = json.loads(base64.b64decode(paid))
        if SETTLE and net == "base-sepolia":
            return self._settle(scenario, net, url, amount, payment)
        RESULTS.mkdir(exist_ok=True)
        out = RESULTS / ("%s_%s_%d.json" % (scenario, net, int(time.time())))
        out.write_text(json.dumps({"scenario": scenario, "network": net, "payment": payment}, indent=2))
        print("[SIGNED] %s on %s -> captured %s (NOT settled)" % (scenario, net, out.name), flush=True)
        receipt = {
            "success": True,
            "transaction": "0x" + "00" * 32,
            "network": NETWORKS[net]["caip2"],
            "payer": payment["payload"]["authorization"]["from"],
            "note": "test seller: signature captured, never settled",
        }
        return self._send(
            200,
            {"scenario": scenario, "wallet_signed": True, "captured": out.name, **receipt},
            {"PAYMENT-RESPONSE": b64(receipt)},
        )

    def _settle(self, scenario, net, url, amount, payment):
        """Verify, then settle on-chain through the x402 facilitator (x402 v2 spec, section 7)."""
        # Requirements come from our own offer, never from what the client echoes back.
        requirements = challenge(scenario, net, url, amount)["accepts"][0]
        body = {"x402Version": 2, "paymentPayload": payment, "paymentRequirements": requirements}
        verify = facilitator("/verify", body)
        if not verify.get("isValid"):
            print("[REJECTED] %s: %s" % (scenario, verify), flush=True)
            pr = dict(challenge(scenario, net, url, amount), error=verify.get("invalidReason", "invalid payment"))
            return self._send(402, pr, {"PAYMENT-REQUIRED": b64(pr)})
        settled = facilitator("/settle", body)
        if not settled.get("success"):
            print("[SETTLE FAILED] %s: %s" % (scenario, settled), flush=True)
            pr = dict(challenge(scenario, net, url, amount), error=settled.get("errorReason", "settlement failed"))
            return self._send(402, pr, {"PAYMENT-REQUIRED": b64(pr)})
        tx = settled.get("transaction")
        print("[SETTLED] %s on %s -> https://sepolia.basescan.org/tx/%s" % (scenario, net, tx), flush=True)
        resource = {"scenario": scenario, "data": "premium report: the thing you paid for",
                    "explorer": "https://sepolia.basescan.org/tx/%s" % tx}
        return self._send(200, {**resource, **settled}, {"PAYMENT-RESPONSE": b64(settled)})

    def log_message(self, fmt, *args):
        print("%s  %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4020)
    ap.add_argument("--settle", action="store_true", help="settle base-sepolia payments on-chain via %s" % FACILITATOR)
    args = ap.parse_args()
    port, SETTLE = args.port, args.settle
    print("x402 gap-test seller on http://127.0.0.1:%d/s/<scenario>?net=base|base-sepolia" % port)
    for k, (d, _) in SCENARIOS.items():
        print("  %-11s %s" % (k, d))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
