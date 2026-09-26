// Intercepta (Web3 Antivirus) API client.
// Docs: https://docs.web3antivirus.io/reference

const BASE = "https://api.web3antivirus.io/api/public/v2/extension";

export type Trait = { name: string; risk: number; txsCount?: number; description?: string };
export type AddressScan = { toxicScore: number; traits: Trait[] };
export type TokenScan = {
  riskScore: number;
  riskLevel: string;
  category: string;
  trust?: string;
  action: string;
  token?: { symbol?: string | null; address?: string; chainId?: string };
  detectors: { code: string; description: string }[];
};
export type MessageScan = {
  messageType: string | null;
  riskGroup: "Low" | "Medium" | "High";
  detectors: { code: string; description: string }[];
  addresses: { address: string; type: string; detectors: string[] }[];
};

export class InterceptaError extends Error {
  constructor(
    readonly status: number | "timeout" | "network",
    readonly body: string,
  ) {
    super(`Intercepta ${status}: ${body.slice(0, 200)}`);
  }
}

async function call<T>(apiKey: string, method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 15000) {
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        "X-API-KEY": apiKey,
        Accept: "application/json",
        // Cloudflare in front of the API rejects some default runtime user agents (error 1010).
        "User-Agent": "mm-x402-guard/0.1",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = (e as Error).name;
    throw new InterceptaError(name === "TimeoutError" ? "timeout" : "network", String(e));
  }
  const text = await res.text();
  if (!res.ok) throw new InterceptaError(res.status, text);
  return { data: JSON.parse(text) as T, ms: Date.now() - t0 };
}

export class Intercepta {
  constructor(private readonly apiKey: string) {}

  /** Fast list-based check (sanctions, known scammers, blacklists). */
  quickScanAddress(address: string, timeoutMs?: number) {
    return call<AddressScan>(this.apiKey, "GET", `/account/${address}/quick-scan`, undefined, timeoutMs);
  }

  /** Behavioural exposure: mixers, sanctioned counterparties, scam flows. Slower. */
  deepScanAddress(address: string, timeoutMs?: number) {
    return call<AddressScan>(this.apiKey, "GET", `/account/${address}/toxic-score`, undefined, timeoutMs);
  }

  scanToken(address: string, chainId: number, timeoutMs?: number) {
    return call<TokenScan>(this.apiKey, "GET", `/token-intelligence/token/${address}/risks?chainId=${chainId}`, undefined, timeoutMs);
  }

  /**
   * Scan the EIP-712 payload we are about to sign.
   * The docs describe `message` as a JSON string, but a string is silently left unparsed
   * (riskGroup "Low", domain null). It must be sent as an object.
   */
  scanMessage(from: string, typedData: unknown, chainId: number, website?: string, timeoutMs?: number) {
    return call<MessageScan>(
      this.apiKey,
      "POST",
      "/analysis/signature",
      { from, message: typedData, chainId: String(chainId), ...(website ? { website } : {}) },
      timeoutMs,
    );
  }
}
