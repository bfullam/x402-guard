import { type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { type FlowResult, hintFor, runX402 } from "../../lib/flow.js";

const inputs = {
  url: { type: InputFieldType.Text, flag: "url", message: "Paywalled URL (returns HTTP 402)", required: true, prompt: false, index: 0 },
  asset: { type: InputFieldType.Text, flag: "asset", message: "Pick the offer paying in this token contract", required: false, prompt: false },
  network: { type: InputFieldType.Text, flag: "network", message: "Pick the offer on this network (e.g. eip155:8453)", required: false, prompt: false },
} satisfies InputSchema;

export default class X402Inspect extends PluginCommand<FlowResult> {
  static override description = "Show an x402 offer and the Intercepta verdict, without signing anything.";
  static override examples = ["<%= config.bin %> x402 inspect https://api.example.com/premium"];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "x402:inspect";

  async execute(io: CommandIO) {
    const i = await io.resolveInputs(inputs);
    return runX402(this.ctx, io, this.pluginCommandId, {
      url: i.url, asset: i.asset || undefined, network: i.network || undefined, dryRun: true,
    });
  }

  override successHint(r: FlowResult) {
    return hintFor(r);
  }
}
