import { createHash } from "node:crypto";
import { type CommandIO, CommandError, type PluginCommandContext } from "@metamask/agent-wallet/plugin";
import { apiKey, readConfig } from "./config.js";
import { renderVerdict, screenPayment, type Verdict } from "./guard.js";
import { Intercepta } from "./intercepta.js";
import { recordPayment } from "./ledger.js";
import { activeAddress, tokenDecimals } from "./wallet.js";
import {
  buildPaymentHeader, buildTypedData, type Option, parse402, readSettlement, request, selectOption, X402Error,
} from "./x402.js";

export type FlowArgs = { url: string; asset?: string; network?: string; approve?: string; dryRun: boolean };

export type FlowResult = {
  status: "screened" | "paid" | "needs_approval" | "refused" | "payment_rejected";
  url: string;
  payTo: string;
  asset: string;
  amount: string;
  amountUsd: number | null;
  network: string;
  verdict: Omit<Verdict, "amountUsd">;
  /** Present on needs_approval: pass back with --approve after the human agrees. Bound to this payTo/asset/amount. */
  approvalCode?: string;
  approvedBy?: "human";
  signature?: string;
  settlement?: unknown;
  resource?: unknown;
  error?: string;
};

/** Binds a human approval to the exact payment it was given for. */
export const approvalCodeFor = (o: Option) =>
  createHash("sha256").update([o.payTo, o.asset, o.amount, o.network].join("|").toLowerCase()).digest("hex").slice(0, 8);

export async function runX402(ctx: PluginCommandContext, io: CommandIO, source: string, a: FlowArgs): Promise<FlowResult> {
  const cfg = readConfig();
  const api = new Intercepta(apiKey(cfg));

  io.progress("Fetching payment requirements...");
  const challenge = await parse402(await request(a.url));
  const option = selectOption(challenge.options, { asset: a.asset, network: a.network });
  const from = activeAddress(ctx);
  const validitySeconds = Math.min(option.maxTimeoutSeconds, cfg.maxValiditySeconds);
  // Build the exact authorization first, so what we screen is what we sign.
  const { typedData, authorization } = buildTypedData(option, from, validitySeconds);

  io.progress("Screening with Intercepta...");
  const decimals = await tokenDecimals(ctx, option.chainId!, option.asset);
  const verdict = await screenPayment(api, cfg, {
    option, from, typedData, validitySeconds, decimals,
    clamped: validitySeconds < option.maxTimeoutSeconds,
    website: new URL(a.url).host,
  });
  const amountLabel = verdict.amountUsd !== null ? `$${verdict.amountUsd}` : `${option.amount} (atomic units)`;
  for (const line of renderVerdict(verdict, option, amountLabel)) io.emit(line);

  const { amountUsd, ...v } = verdict;
  const base = {
    url: a.url, payTo: option.payTo, asset: option.asset, amount: option.amount, amountUsd,
    network: option.network, verdict: v,
  };
  const code = approvalCodeFor(option);

  if (verdict.decision === "REFUSE") return { ...base, status: "refused" };
  if (a.dryRun) return { ...base, status: "screened", ...(verdict.decision === "ASK" ? { approvalCode: code } : {}) };

  let approvedBy: "human" | undefined;
  if (verdict.decision === "ASK") {
    if (a.approve) {
      if (a.approve !== code) {
        throw new CommandError(
          "APPROVAL_MISMATCH",
          "Approval code does not match this payment: payTo, asset, amount or network changed since the human approved.",
          "Run `mm x402 inspect <url>`, show the user the new verdict, and ask again.",
        );
      }
      approvedBy = "human";
      io.emit("  ✔ approved by the human for exactly this payTo, asset and amount");
    } else if (io.isInteractive) {
      const ok = await io.ask({ kind: "confirm", message: `Pay ${amountLabel} to ${option.payTo} anyway?` });
      if (!ok) return { ...base, status: "needs_approval", approvalCode: code };
      approvedBy = "human";
    } else {
      return { ...base, status: "needs_approval", approvalCode: code };
    }
  }

  io.progress("Signing with MetaMask Agent Wallet...");
  const exec = await ctx.walletExecutor(io, source);
  const signed: any = await exec(
    {
      kind: "typed-data",
      chainId: option.chainId!,
      typedData,
      // WalletIntent shape used by the host (`WalletIntent.custom`): shown to the user and sent with the request.
      intent: {
        action: "custom",
        summary: `x402 (Intercepta: ${verdict.tier}${approvedBy ? ", human-approved" : ""}) ${amountLabel} to ${option.payTo} for ${a.url}`,
      },
    } as any,
    { signal: io.signal },
  );
  if (signed?.kind !== "signature" || !signed.signature) {
    throw new X402Error(`MetaMask did not sign (status ${signed?.status}): ${signed?.failureDescription ?? ""}`);
  }

  io.progress("Sending payment...");
  const header = buildPaymentHeader(challenge, option, a.url, signed.signature, authorization);
  const res = await request(a.url, { [header.name]: header.value });
  const body = await res.text();
  if (res.status !== 200) {
    return { ...base, status: "payment_rejected", signature: signed.signature, error: `HTTP ${res.status}: ${body.slice(0, 300)}`, approvedBy };
  }
  recordPayment({ usd: verdict.amountUsd ?? 0, payTo: option.payTo, url: a.url, network: option.network });
  let resource: unknown = body;
  try {
    resource = JSON.parse(body);
  } catch {}
  return {
    ...base, status: "paid", approvedBy, signature: signed.signature,
    settlement: readSettlement(res, challenge.version, body), resource,
  };
}

export function hintFor(r: FlowResult): string {
  switch (r.status) {
    case "paid": return `Paid ${r.amountUsd !== null ? `$${r.amountUsd}` : r.amount} to ${r.payTo}.`;
    case "refused": return `Refused: ${r.verdict.reasons[0] ?? "blocked by policy"}. Do not retry this payment.`;
    case "needs_approval":
      return `Needs human approval. Show the user the reasons above; only if they agree, rerun with --approve ${r.approvalCode}.`;
    case "screened": return `Verdict: ${r.verdict.decision}. Nothing was signed.`;
    default: return `Payment rejected by the server: ${r.error}`;
  }
}
