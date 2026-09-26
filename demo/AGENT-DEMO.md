# Recording the agent demo

A Claude Code session in this repo, with the `x402-guard` skill (`.claude/skills/x402-guard`), buys three reports.
The agent pays through `mm x402 pay`; the plugin screens each payment with Intercepta before MetaMask signs.

## Setup (once)

```bash
nvm alias default 24                                  # mm refuses Node 20
mm x402 config --intercepta-key <key>                  # or it is already stored in ~/.x402-guard
python3 demo/seller.py --port 4020 --settle            # its own terminal; Base Sepolia, settles for real
```

The seller's demo routes look like ordinary paid APIs, so the verdict isn't given away by the URL:

| URL                                            | Payee                                   | Expected           |
| ---------------------------------------------- | --------------------------------------- | ------------------ |
| `http://127.0.0.1:4020/reports/market-data`    | fresh address                           | ✅ paid, tx link   |
| `http://127.0.0.1:4020/reports/whale-alerts`   | Lazarus Group (OFAC)                    | ⛔ refused         |
| `http://127.0.0.1:4020/reports/alpha-signals`  | wallet with 8 Tornado Cash deposits, $0.50 | ✋ asks you     |

## Script

Start a fresh `claude` session in the repo root, then:

1. "Buy me the market data report at http://127.0.0.1:4020/reports/market-data"
   → pays, shows the verdict and the Base Sepolia transaction.
2. "Now get the whale alerts report at http://127.0.0.1:4020/reports/whale-alerts"
   → refuses, explains the sanctions / known-scammer reasons, and doesn't retry.
3. "And the alpha signals report at http://127.0.0.1:4020/reports/alpha-signals"
   → stops and asks you, citing the mixer exposure and the $0.10 caution ceiling.
4. Answer "yes, pay it"
   → reruns with the approval code; pays and settles.

`.claude/settings.local.json` pre-allows `mm x402 pay|inspect|screen`, so there are no permission prompts on camera.
`mm x402 config` is not pre-allowed: only you change the limits.
