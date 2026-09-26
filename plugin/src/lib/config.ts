import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOME = join(homedir(), ".x402-guard");
const CONFIG = join(HOME, "config.json");

export type GuardConfig = {
  /** Intercepta API key. INTERCEPTA_API_KEY in the environment takes precedence. */
  interceptaApiKey?: string;
  /** Largest single payment (USD) paid without asking, to a clean counterparty. */
  maxPerPayment: number;
  /** Largest single payment (USD) paid without asking, to a counterparty with caution-level risk. */
  cautionCap: number;
  /** Rolling 24h total (USD) of x402 payments signed through the guard. */
  dailyCap: number;
  /** Longest payment authorization we will sign, in seconds (the server's maxTimeoutSeconds is clamped). */
  maxValiditySeconds: number;
  /** How long to wait for a deep address scan before deciding without it. */
  deepScanTimeoutMs: number;
};

export const DEFAULTS: GuardConfig = {
  maxPerPayment: 1,
  cautionCap: 0.1,
  dailyCap: 5,
  maxValiditySeconds: 600,
  deepScanTimeoutMs: 8000,
};

export function readConfig(): GuardConfig {
  let file: Partial<GuardConfig> = {};
  if (existsSync(CONFIG)) file = JSON.parse(readFileSync(CONFIG, "utf8"));
  return { ...DEFAULTS, ...file };
}

export function writeConfig(patch: Partial<GuardConfig>): GuardConfig {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const next = { ...readConfig(), ...patch };
  writeFileSync(CONFIG, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export function apiKey(cfg: GuardConfig): string {
  const key = process.env.INTERCEPTA_API_KEY || cfg.interceptaApiKey;
  if (!key) throw new Error("No Intercepta API key. Set INTERCEPTA_API_KEY or run `mm x402 config --intercepta-key <key>`.");
  return key;
}
