import { type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { apiKey, readConfig } from "../../lib/config.js";
import { type Check, screenAddress, type Tier } from "../../lib/guard.js";
import { Intercepta } from "../../lib/intercepta.js";

const inputs = {
  address: { type: InputFieldType.Text, flag: "address", message: "Wallet address to profile", required: true, prompt: false, index: 0 },
} satisfies InputSchema;

type ScreenResult = { address: string; tier: Tier; payCapUsd: number; reasons: string[]; checks: Check[] };

export default class X402Screen extends PluginCommand<ScreenResult> {
  static override description = "Counterparty risk profile: should this agent pay (or be paid by) this address, and how much?";
  static override examples = ["<%= config.bin %> x402 screen 0x098B716B8Aaf21512996dC57EB0615e2383E2f96"];
  static override requiresInit = false;
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "x402:screen";

  async execute(io: CommandIO) {
    const { address } = await io.resolveInputs(inputs);
    const cfg = readConfig();
    io.progress("Screening with Intercepta...");
    const r = await screenAddress(new Intercepta(apiKey(cfg)), address, cfg);
    const cap = r.tier === "clean" ? cfg.maxPerPayment : r.tier === "caution" ? cfg.cautionCap : 0;
    return { address, tier: r.tier, payCapUsd: cap, reasons: r.reasons, checks: r.checks };
  }

  override successHint(r: ScreenResult) {
    const tag = { clean: "✅ clean", caution: "▲ caution", blocked: "⛔ blocked" }[r.tier];
    return `${tag}: auto-pay up to $${r.payCapUsd}${r.reasons.length ? ` (${r.reasons.join("; ")})` : ""}`;
  }
}
