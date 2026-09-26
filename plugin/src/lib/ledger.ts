// Local record of x402 payments signed through the guard, for the rolling 24h cap
// (MetaMask's outflow limit does not count signatures) and a deep-scan cache.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOME } from "./config.js";

const LEDGER = join(HOME, "ledger.json");
const CACHE = join(HOME, "scan-cache.json");
const DAY = 24 * 3600 * 1000;

type Entry = { at: number; usd: number; payTo: string; url: string; network: string };

function load<T>(path: string, fallback: T): T {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(path: string, data: unknown) {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function spentLast24h(now = Date.now()): number {
  return load<Entry[]>(LEDGER, [])
    .filter((e) => now - e.at < DAY)
    .reduce((sum, e) => sum + e.usd, 0);
}

export function recordPayment(e: Omit<Entry, "at">) {
  const now = Date.now();
  const kept = load<Entry[]>(LEDGER, []).filter((x) => now - x.at < 7 * DAY);
  save(LEDGER, [...kept, { ...e, at: now }]);
}

export function cachedDeepScan<T>(address: string, maxAgeMs = DAY): T | undefined {
  const hit = load<Record<string, { at: number; data: T }>>(CACHE, {})[address.toLowerCase()];
  return hit && Date.now() - hit.at < maxAgeMs ? hit.data : undefined;
}

export function cacheDeepScan(address: string, data: unknown) {
  const all = load<Record<string, unknown>>(CACHE, {});
  all[address.toLowerCase()] = { at: Date.now(), data };
  save(CACHE, all);
}
