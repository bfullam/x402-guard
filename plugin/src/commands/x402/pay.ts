import { type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { type FlowResult, hintFor, runX402 } from "../../lib/flow.js";

const inputs = {
  url: { type: InputFieldType.Text, flag: "url", message: "Paywalled URL (returns HTTP 402)", required: true, prompt: false, index: 0 },
  asset: { type: InputFieldType.Text, flag: "asset", message: "Pick the offer paying in this token contract", required: false, prompt: false },
  network: { type: InputFieldType.Text, flag: "network", message: "Pick the offer on this network (e.g. eip155:8453)", required: false, prompt: false },
  approve: {
    type: InputFieldType.Text, flag: "approve", required: false, prompt: false,
    message: "Approval code from a needs_approval result. Only pass it after the human explicitly agreed.",
  },
} satisfies InputSchema;

export default class X402Pay extends PluginCommand<FlowResult> {
  static override description =
    "Pay an x402 (HTTP 402) resource after screening the payee, token and authorization with Intercepta.";
  static override examples = [
    "<%= config.bin %> x402 pay https://api.example.com/premium",
    "<%= config.bin %> x402 pay https://api.example.com/premium --approve 1a2b3c4d",
  ];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "x402:pay";

  async execute(io: CommandIO) {
    const i = await io.resolveInputs(inputs);
    return runX402(this.ctx, io, this.pluginCommandId, {
      url: i.url, asset: i.asset || undefined, network: i.network || undefined, approve: i.approve || undefined, dryRun: false,
    });
  }

  override successHint(r: FlowResult) {
    return hintFor(r);
  }
}
