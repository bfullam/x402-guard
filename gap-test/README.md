# Gap test: does MetaMask Agent Wallet screen x402 payments?

x402 payments are EIP-3009 `TransferWithAuthorization` **signatures** (`mm wallet sign-typed-data`),
not transactions. MetaMask's docs describe Blockaid scanning and outflow limits for transactions and
say signatures are excluded from outflow tracking. This harness checks what actually happens.

`seller.py` is a local x402 v2 seller that asks for bad payments. `run_matrix.sh` pays each one with
MetaMask's own helper (`vendor/x402_pay.py`, unmodified from `MetaMask/agent-skills`) and records
whether the wallet signed. **Nothing is ever settled on-chain**: the seller logs the signature and
returns a fake receipt.

| Scenario     | What it asks for                                                    |
| ------------ | ------------------------------------------------------------------- |
| `clean`      | 0.01 USDC to a fresh address with no history (control)              |
| `sanctioned` | 0.01 USDC to `0x098B…2f96`, OFAC SDN (Lazarus / Ronin exploiter)    |
| `fake-usdc`  | 0.01 of `0x8335…2914`, one hex digit off Base USDC, domain "USD Coin" |
| `big`        | 5,000 USDC (does the 24h outflow limit apply to signatures?)        |
| `long-lived` | authorization valid for 1 year                                      |

Each runs on `base` (mainnet, Blockaid-covered) and `base-sepolia` (testnet).
Sanctions status verified with the Chainalysis oracle on Ethereum mainnet.

## Run

```bash
npm i -g @metamask/agent-wallet && mm login && mm init --mode guard && mm doctor
python3 gap-test/seller.py            # terminal 1
gap-test/run_matrix.sh                # terminal 2; or: run_matrix.sh sanctioned base
```

If a 2FA approval arrives, write down which scenario triggered it and **reject** it (the run then shows `STOPPED`).
Harness self-test without a wallet: `PATH="$PWD/gap-test/selftest:$PATH" gap-test/run_matrix.sh`.

Use a wallet with no mainnet funds if you prefer. Signatures are never submitted anyway.
