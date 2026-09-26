// Screens an x402 payment with Intercepta and decides what happens next: PAY, ASK (a human), or REFUSE.
import type { GuardConfig } from "./config.js";
import { type AddressScan, Intercepta, InterceptaError, type MessageScan, type TokenScan, type Trait } from "./intercepta.js";
import { cacheDeepScan, cachedDeepScan, spentLast24h } from "./ledger.js";
import type { Option } from "./x402.js";

export type Decision = "PAY" | "ASK" | "REFUSE";
export type Tier = "clean" | "caution" | "blocked";
export type Check = { check: string; status: "pass" | "warn" | "fail" | "error"; detail: string; ms?: number };

export type Verdict = {
  decision: Decision;
  tier: Tier;
  reasons: string[];
  checks: Check[];
  amountUsd: number | null;
  limitUsd: number;
  spent24hUsd: number;
  validitySeconds: number;
};

// Traits that mean "do not pay this address".
const SEVERE = new Set(["sanction_address", "known_scammer", "blacklist"]);
// Traits that mean "exposure worth a lower ceiling or a human look".
const CAUTION = new Set([
  "mixer_transfers", "sanction_address_communication", "initiator_scam_transactions", "fake_phishing_transfer",
  "fake_phishing_contract_communication", "rug_pull", "rug_pull_trader", "attack_money_target",
  "suspicious_deployer", "suspicious_dex_pair_deployer", "zero_address_risk",
]);
const STABLES = new Set(["USDC", "USDT", "DAI", "PYUSD", "USDS", "USDBC"]);

// Intercepta has no testnet data. Screen testnet payments against the mainnet sibling chain, and
// recognise Circle's testnet USDC deployments explicitly (addresses from developers.circle.com).
const MAINNET_OF: Record<number, number> = { 84532: 8453, 11155111: 1, 11155420: 10, 421614: 42161, 59141: 59144 };
const TESTNET_USDC: Record<number, string> = {
  84532: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  11155111: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
  11155420: "0x5fd84259d66cd46123540766be93dfe6d43130d7",
  421614: "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
};

const fmtTraits = (ts: Trait[]) =>
  ts.map((t) => `${t.name}(${Math.round(t.risk * 100) / 100}${t.txsCount ? `, ${t.txsCount} txs` : ""})`).join(", ");

async function timed<T>(p: Promise<{ data: T; ms: number }>) {
  try {
    const r = await p;
    return { ok: true as const, ...r };
  } catch (e) {
    return { ok: false as const, error: e as Error };
  }
}

export type ScreenInput = {
  option: Option;
  from: string;
  typedData: unknown;
  validitySeconds: number;
  clamped: boolean;
  decimals: number | null;
  website?: string;
};

/** Counterparty risk profile for one address (also used by `mm x402 screen`). */
export async function screenAddress(api: Intercepta, address: string, cfg: GuardConfig) {
  const cached = cachedDeepScan<AddressScan>(address);
  const [quick, deep] = await Promise.all([
    timed(api.quickScanAddress(address)),
    cached ? Promise.resolve({ ok: true as const, data: cached, ms: 0 }) : timed(api.deepScanAddress(address, cfg.deepScanTimeoutMs)),
  ]);
  if (deep.ok && !cached) cacheDeepScan(address, deep.data);
  const checks: Check[] = [];
  const reasons: string[] = [];
  let tier: Tier = "clean";
  const raise = (t: Tier) => {
    if (t === "blocked" || (t === "caution" && tier === "clean")) tier = t;
  };

  const isContract = [quick, deep].some((r) => !r.ok && r.error instanceof InterceptaError && r.error.status === 404);
  if (isContract) {
    raise("caution");
    reasons.push("payTo is a contract; Intercepta address scans only cover wallets (EOAs)");
    checks.push({ check: "address", status: "warn", detail: "contract address, not scannable" });
    return { tier: tier as Tier, reasons, checks, quick, deep };
  }

  for (const [label, r] of [["quick-scan", quick], ["deep-scan", deep]] as const) {
    if (!r.ok) {
      checks.push({ check: label, status: "error", detail: r.error.message });
      continue;
    }
    const { toxicScore, traits } = r.data;
    const severe = traits.filter((t) => SEVERE.has(t.name) || t.risk >= 70);
    const caution = traits.filter((t) => !severe.includes(t) && (CAUTION.has(t.name) ? t.risk > 0 : t.risk >= 20));
    if (severe.length || toxicScore >= 70) {
      raise("blocked");
      checks.push({ check: label, status: "fail", detail: `toxicScore ${toxicScore}: ${fmtTraits(severe)}`, ms: r.ms });
    } else if (caution.length || toxicScore >= 20) {
      raise("caution");
      checks.push({ check: label, status: "warn", detail: `toxicScore ${toxicScore}: ${fmtTraits(caution)}`, ms: r.ms });
    } else {
      checks.push({ check: label, status: "pass", detail: `toxicScore ${toxicScore}${traits.length ? ` (${fmtTraits(traits)})` : ""}`, ms: r.ms });
    }
  }
  for (const c of checks) if (c.status === "fail" || c.status === "warn") reasons.push(`payTo ${c.check}: ${c.detail}`);

  if (!quick.ok && !deep.ok) {
    raise("caution");
    reasons.push("could not screen payTo (Intercepta unavailable)");
  } else if (!deep.ok) {
    raise("caution");
    reasons.push("deep scan unavailable; mixer / sanctions exposure not checked");
  }
  return { tier: tier as Tier, reasons, checks, quick, deep };
}

export async function screenPayment(api: Intercepta, cfg: GuardConfig, input: ScreenInput): Promise<Verdict> {
  const { option: o } = input;
  const chainId = o.chainId!;
  const scanChain = MAINNET_OF[chainId] ?? chainId;
  const testnetUsdc = TESTNET_USDC[chainId];

  const [addr, token, message] = await Promise.all([
    screenAddress(api, o.payTo, cfg),
    testnetUsdc ? Promise.resolve(null) : timed<TokenScan>(api.scanToken(o.asset, chainId)),
    timed<MessageScan>(api.scanMessage(input.from, input.typedData, scanChain, input.website)),
  ]);

  let tier = addr.tier as Tier;
  const reasons = [...addr.reasons];
  const checks = [...addr.checks];
  const raise = (t: Tier) => {
    if (t === "blocked" || (t === "caution" && tier === "clean")) tier = t;
  };

  // Token: pay only in tokens Intercepta has verified as genuine.
  let symbol: string | null = null;
  if (testnetUsdc) {
    if (o.asset.toLowerCase() === testnetUsdc) {
      symbol = "USDC";
      checks.push({ check: "token", status: "pass", detail: "Circle testnet USDC (no Intercepta testnet data)" });
    } else {
      raise("blocked");
      checks.push({ check: "token", status: "fail", detail: `unknown testnet token ${o.asset}` });
      reasons.push("token is not Circle's USDC on this testnet");
    }
  } else if (token && token.ok) {
    const t = token.data;
    symbol = t.token?.symbol ?? null;
    if (t.action === "block" || t.riskLevel === "high") {
      raise("blocked");
      checks.push({ check: "token", status: "fail", detail: `${t.category}: ${t.detectors.map((d) => d.code).join(", ")}`, ms: token.ms });
      reasons.push(`token flagged ${t.category} (${t.detectors.map((d) => d.code).join(", ")})`);
    } else if (t.trust !== "whitelist") {
      raise("blocked");
      checks.push({ check: "token", status: "fail", detail: `not verified (trust=${t.trust}, symbol=${symbol})`, ms: token.ms });
      reasons.push(`token ${o.asset} is not a verified token (lookalike or unknown); claims to be "${o.extra.name}"`);
    } else {
      checks.push({ check: "token", status: "pass", detail: `${symbol} verified (trust=whitelist)`, ms: token.ms });
    }
  } else if (token && !token.ok) {
    raise("blocked");
    checks.push({ check: "token", status: "error", detail: token.error.message });
    reasons.push("could not verify the token");
  }

  // The authorization itself.
  if (message.ok) {
    const m = message.data;
    const codes = m.detectors.map((d) => d.code);
    if (m.riskGroup === "High") {
      raise("blocked");
      checks.push({ check: "scan-message", status: "fail", detail: `High: ${codes.join(", ")}`, ms: message.ms });
      reasons.push(`authorization scan High risk: ${codes.join(", ")}`);
    } else if (m.riskGroup === "Medium") {
      raise("caution");
      checks.push({ check: "scan-message", status: "warn", detail: `Medium: ${codes.join(", ")}`, ms: message.ms });
      reasons.push(`authorization scan Medium risk: ${codes.join(", ")}`);
    } else {
      checks.push({ check: "scan-message", status: "pass", detail: `${m.riskGroup} (${m.messageType ?? "unparsed"})`, ms: message.ms });
    }
  } else {
    checks.push({ check: "scan-message", status: "error", detail: message.error.message });
  }

  // Our own limits: MetaMask's outflow limit does not count signatures.
  checks.push({
    check: "validity",
    status: input.clamped ? "warn" : "pass",
    detail: input.clamped
      ? `server asked ${o.maxTimeoutSeconds}s, clamped to ${input.validitySeconds}s`
      : `${input.validitySeconds}s`,
  });
  const amountUsd =
    input.decimals !== null && symbol && STABLES.has(symbol.toUpperCase())
      ? Number(BigInt(o.amount)) / 10 ** input.decimals
      : null;
  const spent = spentLast24h();
  const limit = tier === "clean" ? cfg.maxPerPayment : tier === "caution" ? cfg.cautionCap : 0;

  let decision: Decision;
  if (tier === "blocked") {
    decision = "REFUSE";
  } else if (amountUsd === null) {
    decision = "ASK";
    reasons.push("could not value the payment in USD");
  } else if (amountUsd > limit) {
    decision = "ASK";
    reasons.push(`$${amountUsd} exceeds the $${limit} cap for a ${tier} counterparty`);
  } else if (spent + amountUsd > cfg.dailyCap) {
    decision = "ASK";
    reasons.push(`would take 24h x402 spend to $${(spent + amountUsd).toFixed(2)} (cap $${cfg.dailyCap})`);
  } else {
    decision = "PAY";
    if (tier === "caution") reasons.push(`within the $${limit} cap for a caution-tier counterparty`);
  }
  checks.push({
    check: "limits",
    status: decision === "PAY" ? "pass" : tier === "blocked" ? "fail" : "warn",
    detail: `amount $${amountUsd ?? "?"}, tier cap $${limit}, 24h $${spent.toFixed(2)} of $${cfg.dailyCap}`,
  });

  return { decision, tier, reasons, checks, amountUsd, limitUsd: limit, spent24hUsd: spent, validitySeconds: input.validitySeconds };
}

export function renderVerdict(v: Verdict, o: Option, amountLabel: string): string[] {
  const icon = { pass: "✔", warn: "▲", fail: "✖", error: "?" } as const;
  const head = { PAY: "✅ PAY", ASK: "✋ ASK HUMAN", REFUSE: "⛔ REFUSE" }[v.decision];
  return [
    `x402 payment: ${amountLabel} to ${o.payTo} on ${o.network}`,
    ...v.checks.map((c) => `  ${icon[c.status]} ${c.check.padEnd(12)} ${c.detail}${c.ms ? `  (${c.ms}ms)` : ""}`),
    `${head}  [counterparty: ${v.tier}]`,
    ...v.reasons.map((r) => `  - ${r}`),
  ];
}
