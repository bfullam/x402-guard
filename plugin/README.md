# mm-plugin-x402-guard

A [MetaMask Agent Wallet](https://docs.metamask.io/agent-wallet/) plugin that screens every x402 payment with
[Intercepta](https://intercepta.io) **before** the wallet signs it, then decides: **pay**, **cap**, **ask a human**,
or **refuse**.

x402 payments are EIP-3009 signatures, not transactions. In our tests (`../gap-test`), a Guard Mode wallet
signed x402 payments to an OFAC-sanctioned address, a lookalike USDC, a 1-year authorization and 96% of its
balance, with no prompt. This plugin puts the check in that path.

## What it checks

| Check        | Intercepta endpoint | Effect                                                                         |
| ------------ | ------------------- | ------------------------------------------------------------------------------ |
| payTo        | Quick Scan Address  | sanctioned / known scammer / blacklist → **refuse**                              |
| payTo        | Deep Scan Address   | mixer, sanctioned-counterparty, scam exposure → **caution** tier (lower ceiling) |
| token        | Scan Token          | not a verified token (e.g. lookalike USDC) → **refuse**                          |
| authorization| Scan Message        | High → **refuse**, Medium → **caution**                                          |
| limits       | (local)             | over the tier ceiling or 24h cap → **ask**; validity clamped to 10 min         |

Tiers: `clean` auto-pays up to $1, `caution` up to $0.10, and `blocked` never pays. Anything above a ceiling goes to a
human, with an approval code bound to that exact payee, token and amount. Refusals can't be overridden. Signing
still goes through MetaMask's own policy pipeline (`walletExecutor`), so this adds to Guard Mode rather than
replacing it.

Where Intercepta is called: [`src/lib/intercepta.ts`](src/lib/intercepta.ts) (client) and
[`src/lib/guard.ts`](src/lib/guard.ts) (`screenAddress`, `screenPayment`: the decision).

## Commands

```bash
mm x402 pay <url> [--approve <code>] [--asset <addr>] [--network eip155:8453]
mm x402 inspect <url>        # verdict only, signs nothing
mm x402 screen <address>     # counterparty risk profile
mm x402 config [--intercepta-key …] [--max-per-payment 1] [--caution-cap 0.1] [--daily-cap 5] [--max-validity 600]
```

Agents: ship [`skills/x402-guard/SKILL.md`](skills/x402-guard/SKILL.md) so the agent uses `mm x402 pay` instead of
signing x402 payloads directly. A plugin can add commands but not intercept `mm wallet sign-typed-data`, so the
skill is what routes the agent here.

## Install (local development)

```bash
npm install && npm run build
./scripts-link-host.sh      # see below
mm config set experimentalPlugins true
mm config set experimentalAllowUnverifiedInstalls true
mm plugins install "file:$PWD" --accept-permissions
export INTERCEPTA_API_KEY=…   # or: mm x402 config --intercepta-key …
```

`scripts-link-host.sh`: a `file:` install is a symlink, so Node loads `@metamask/agent-wallet` from this folder's
`node_modules`. That's a second copy of the CLI, and it crashes the host with `window.addEventListener is not a
function`. The script points the dev dependency at the host's install. (The official template has the same problem, and
its `minCliVersion: ^6.2.0` also refuses to install on CLI 7.x.)

Built from [MetaMask/agent-wallet-plugin-template](https://github.com/MetaMask/agent-wallet-plugin-template) (MIT).
