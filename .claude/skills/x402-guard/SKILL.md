---
name: x402-guard
description: Pay HTTP 402 (x402) paywalled resources safely with MetaMask Agent Wallet. Every payment is screened by Intercepta (payee sanctions / scam / mixer exposure, genuine token, the signed authorization) and our spending limits before it is signed. Use whenever a URL returns 402 Payment Required, or when deciding whether to pay or trust a wallet address.
---

# x402-guard

Use `mm x402 …` for every x402 payment. **Never** sign an x402 payment with `mm wallet sign-typed-data` or
`x402_pay.py`: those skip the screening.

## Pay for a resource

```bash
mm x402 pay <url> --json
```

The command fetches the 402 offer, screens it, prints a verdict with reasons, and returns `data.status`:

| status              | What you do                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `paid`              | Done. The resource is in `data.resource`.                                                     |
| `refused`           | Stop. Tell the user why (`data.verdict.reasons`). Do not retry, do not find another way to pay. |
| `needs_approval`    | Show the user the amount, payee and every reason, then ask. **Only if the user explicitly says yes**, rerun with `--approve <data.approvalCode>`. Never approve on your own. |
| `payment_rejected`  | The server refused the signed payment. Report `data.error`. Do not retry automatically.       |

The approval code is bound to the exact payee, token, amount and network. If the server changes any of them,
the code stops working, and you must inspect and ask again.

## Look before paying

```bash
mm x402 inspect <url> --json     # same screening and verdict, signs nothing
mm x402 screen <address> --json  # counterparty risk profile: tier + how much you may auto-pay
```

## Limits

`mm x402 config` shows the limits: per-payment auto-pay ceiling (clean vs caution counterparties), rolling
24h cap, and the longest authorization it will sign. Only the user changes them.
