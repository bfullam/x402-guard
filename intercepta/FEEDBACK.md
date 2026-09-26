# Intercepta API: working notes (feeds the README feedback section)

- **Time to first call:** ~10 min. The first request was a 403 (Cloudflare 1010) because Python's default
  `User-Agent` is blocked. Setting any custom UA fixed it. This isn't in the docs.
- **Scan Message `message` field:** the docs say it's a JSON *string*. A string is silently not parsed:
  `riskGroup: "Low"`, `domain: null`, no detectors. That fails open. Sending an *object* works, and
  x402's `TransferWithAuthorization` is recognised (Lazarus payTo came back High / KNOWN_MALICIOUS), even though
  the docs' `messageType` enum lists only Permit variants.
- **Scan Message address typing:** it labels USDC and the Tornado router as `eoa`.
- **Contracts can't be address-scanned:** quick-scan and toxic-score return 404 "An Externally Owned
  Account with this address doesn't exist" for contracts (e.g. the Tornado Cash router). A payTo can be a
  contract (a smart-account seller, a splitter), so this leaves a gap.
- **Quick vs deep scan:** quick-scan returned 0 for 20 Tornado depositors. Deep scan (toxic-score) found
  `mixer_transfers` on all of them, but scored low (0.4 to 15). A policy has to read traits, not just the score.
- **Latency:** quick 0.6 to 4 s; deep 1 to 5 s once warm, 34 s on one cold address. That's too slow to deep-scan
  inline on every x402 call without caching.
- **Scan Token:** a lookalike address with no contract returns riskScore 0 / `action: info`. The real signal is
  `trust: "whitelist"` + `symbol` on real USDC vs `trust: "neutral"` + `symbol: null` on the fake.
- **Chain:** the address scans take no chain parameter, so it's unclear whether Base history is included.
