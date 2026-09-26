"""Minimal Intercepta (Web3 Antivirus) API client. Stdlib only.

Reads INTERCEPTA_API_KEY from the environment or from ../.env.
Docs: https://docs.web3antivirus.io/reference
"""

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://api.web3antivirus.io/api/public/v2/extension"


def _load_key():
    key = os.environ.get("INTERCEPTA_API_KEY")
    if key:
        return key
    env = Path(__file__).resolve().parent.parent / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            k, _, v = line.partition("=")
            if k.strip() == "INTERCEPTA_API_KEY":
                return v.strip().strip('"').strip("'")
    raise RuntimeError("INTERCEPTA_API_KEY not set (env or .env)")


class InterceptaError(Exception):
    def __init__(self, status, body):
        super().__init__("Intercepta HTTP %s: %s" % (status, body[:300]))
        self.status, self.body = status, body


def _call(method, path, body=None, timeout=20):
    req = urllib.request.Request(
        BASE + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"X-API-KEY": _load_key(), "Accept": "application/json", "User-Agent": "x402-guard/0.1",
                 **({"Content-Type": "application/json"} if body is not None else {})},
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        raise InterceptaError(e.code, e.read().decode("utf-8", "replace"))
    return data, round((time.time() - t0) * 1000)


def quick_scan_address(address):
    """Fast payTo/payer check: {toxicScore, traits[]}."""
    return _call("GET", "/account/%s/quick-scan" % address)


def deep_scan_address(address):
    """Sanctions / AML / scam exposure: {toxicScore, traits[]}."""
    return _call("GET", "/account/%s/toxic-score" % address)


def scan_token(address, chain_id):
    """Real USDC or a lookalike: {riskLevel, category, action, detectors[]}."""
    return _call("GET", "/token-intelligence/token/%s/risks?chainId=%s" % (address, chain_id))


def scan_message(from_addr, typed_data, chain_id, website=None):
    """Check an EIP-712 payload before signing: {riskGroup, detectors[], ...}."""
    # Docs say `message` is a JSON *string*, but a string is silently not parsed
    # (riskGroup "Low", domain null). It must be sent as an object.
    body = {"from": from_addr, "message": typed_data, "chainId": str(chain_id)}
    if website:
        body["website"] = website
    return _call("POST", "/analysis/signature", body)
