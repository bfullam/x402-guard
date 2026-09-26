import { type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { type GuardConfig, readConfig, writeConfig } from "../../lib/config.js";

const num = (message: string, flag: string) =>
  ({ type: InputFieldType.Text, flag, message, required: false, prompt: false }) as const;

const inputs = {
  key: { type: InputFieldType.Password, flag: "intercepta-key", message: "Intercepta API key", required: false, prompt: false },
  maxPerPayment: num("Auto-pay ceiling per payment, clean counterparty (USD)", "max-per-payment"),
  cautionCap: num("Auto-pay ceiling per payment, caution counterparty (USD)", "caution-cap"),
  dailyCap: num("Rolling 24h x402 spend cap (USD)", "daily-cap"),
  maxValiditySeconds: num("Longest authorization to sign (seconds)", "max-validity"),
} satisfies InputSchema;

type ConfigView = Omit<GuardConfig, "interceptaApiKey"> & { interceptaApiKey: "set" | "env" | "missing" };

export default class X402Config extends PluginCommand<ConfigView> {
  static override description = "View or set x402-guard limits and the Intercepta API key (stored in ~/.x402-guard).";
  static override examples = [
    "<%= config.bin %> x402 config",
    "<%= config.bin %> x402 config --max-per-payment 1 --caution-cap 0.1 --daily-cap 5",
  ];
  static override requiresAuth = false;
  static override requiresInit = false;
  static override flags = schemaToFlags(inputs);
  protected readonly pluginCommandId = "x402:config";

  async execute(io: CommandIO) {
    const i = await io.resolveInputs(inputs);
    const patch: Partial<GuardConfig> = {};
    if (i.key) patch.interceptaApiKey = i.key;
    for (const k of ["maxPerPayment", "cautionCap", "dailyCap", "maxValiditySeconds"] as const) {
      if (i[k]) {
        const n = Number(i[k]);
        if (!Number.isFinite(n) || n < 0) throw new Error(`${k} must be a non-negative number`);
        patch[k] = n;
      }
    }
    const cfg = Object.keys(patch).length ? writeConfig(patch) : readConfig();
    const { interceptaApiKey, ...rest } = cfg;
    const keyState: ConfigView["interceptaApiKey"] = process.env.INTERCEPTA_API_KEY ? "env" : interceptaApiKey ? "set" : "missing";
    return { ...rest, interceptaApiKey: keyState };
  }
}
