// x402 client protocol: parse a 402 challenge, build the EIP-3009 authorization, send the payment.
// Ported from MetaMask/agent-skills scripts/x402_pay.py (exact scheme, EIP-3009, protocol v1 + v2).
import { randomBytes } from "node:crypto";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

// v1 network names -> chain id. v2 uses CAIP-2 ("eip155:8453") directly.
const V1_NETWORKS: Record<string, number> = {
  ethereum: 1, base: 8453, "base-sepolia": 84532, optimism: 10, arbitrum: 42161,
  polygon: 137, avalanche: 43114, sepolia: 11155111, "optimism-sepolia": 11155420,
  "arbitrum-sepolia": 421614, linea: 59144,
};

export type Option = {
  scheme: string;
  network: string;
  chainId: number | null;
  amount: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
};

export type Challenge = { version: 1 | 2; options: Option[]; resource: unknown };

export class X402Error extends Error {}

export function checkUrl(url: string) {
  const u = new URL(url);
  if (u.protocol === "https:") return;
  if (u.protocol === "http:" && LOOPBACK.has(u.hostname)) return;
  throw new X402Error("resource URL must be https:// (http allowed only on loopback)");
}

export function chainIdFor(network: string): number | null {
  if (network?.startsWith("eip155:")) {
    const n = Number(network.split(":")[1]);
    return Number.isInteger(n) ? n : null;
  }
  return V1_NETWORKS[network] ?? null;
}

export async function request(url: string, headers: Record<string, string> = {}, init: RequestInit = {}) {
  checkUrl(url);
  // Never follow redirects: a cross-host redirect could divert a payment.
  return fetch(url, { ...init, headers: { ...(init.headers as object), ...headers }, redirect: "manual" });
}

export async function parse402(res: Response): Promise<Challenge> {
  if (res.status !== 402) throw new X402Error(`expected HTTP 402, got ${res.status}`);
  const header = res.headers.get("PAYMENT-REQUIRED");
  let data: any;
  let version: 1 | 2;
  if (header) {
    data = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    version = 2;
  } else {
    data = JSON.parse(await res.text());
    version = 1;
    if (!data || !Array.isArray(data.accepts)) throw new X402Error("402 is not a standard x402 challenge (no accepts[])");
  }
  const options: Option[] = (data.accepts ?? []).map((a: any) => ({
    scheme: a.scheme,
    network: a.network,
    chainId: chainIdFor(a.network),
    amount: String(a.amount ?? a.maxAmountRequired ?? ""),
    payTo: a.payTo,
    asset: a.asset,
    maxTimeoutSeconds: Number(a.maxTimeoutSeconds ?? 3600),
    extra: a.extra && typeof a.extra === "object" ? a.extra : {},
  }));
  if (!options.length) throw new X402Error("402 had no payment options");
  return { version, options, resource: data.resource };
}

export function selectOption(options: Option[], want?: { asset?: string; network?: string }): Option {
  const eligible = options.filter(
    (o) =>
      o.scheme === "exact" &&
      o.chainId !== null &&
      (o.extra.assetTransferMethod ?? "eip3009") === "eip3009" &&
      (!want?.asset || o.asset?.toLowerCase() === want.asset.toLowerCase()) &&
      (!want?.network || o.network === want.network),
  );
  if (!eligible.length) throw new X402Error(`no eligible option (need exact scheme, EIP-3009, EVM). Offered: ${JSON.stringify(options)}`);
  if (eligible.length > 1) throw new X402Error("multiple eligible options; disambiguate with --asset / --network");
  const o = eligible[0];
  if (!ADDRESS_RE.test(o.asset ?? "")) throw new X402Error(`asset is not a valid address: ${o.asset}`);
  if (!ADDRESS_RE.test(o.payTo ?? "")) throw new X402Error(`payTo is not a valid address: ${o.payTo}`);
  if (!/^\d+$/.test(o.amount) || BigInt(o.amount) <= 0n) throw new X402Error(`amount must be a positive integer, got ${o.amount}`);
  if (!o.extra.name || !o.extra.version) throw new X402Error("option missing EIP-712 domain name/version in extra");
  return o;
}

export function buildTypedData(o: Option, from: string, validitySeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from,
    to: o.payTo,
    value: o.amount,
    // Backdated like the reference TypeScript client, to absorb clock skew.
    validAfter: String(now - 600),
    validBefore: String(now + validitySeconds),
    nonce: "0x" + randomBytes(32).toString("hex"),
  };
  const typedData = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    domain: { name: String(o.extra.name), version: String(o.extra.version), chainId: o.chainId!, verifyingContract: o.asset },
    message: authorization,
  };
  return { typedData, authorization };
}

export function buildPaymentHeader(c: Challenge, o: Option, url: string, signature: string, authorization: object) {
  const payload =
    c.version === 2
      ? {
          x402Version: 2,
          resource: c.resource ?? { url },
          accepted: {
            scheme: o.scheme, network: o.network, amount: o.amount, asset: o.asset,
            payTo: o.payTo, maxTimeoutSeconds: o.maxTimeoutSeconds, extra: o.extra,
          },
          payload: { signature, authorization },
        }
      : { x402Version: 1, scheme: o.scheme, network: o.network, payload: { signature, authorization } };
  return {
    name: c.version === 2 ? "PAYMENT-SIGNATURE" : "X-PAYMENT",
    value: Buffer.from(JSON.stringify(payload)).toString("base64"),
  };
}

export function readSettlement(res: Response, version: 1 | 2, body: string): any {
  const raw = res.headers.get(version === 2 ? "PAYMENT-RESPONSE" : "X-PAYMENT-RESPONSE");
  if (raw) {
    try {
      return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    } catch {}
  }
  try {
    const d = JSON.parse(body);
    if (d?.transaction || d?.txHash) return d;
  } catch {}
  return null;
}
