import type { PluginCommandContext } from "@metamask/agent-wallet/plugin";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Address of the active EVM wallet, from the host's local wallet state snapshot. */
export function activeAddress(ctx: PluginCommandContext): string {
  const state: any = ctx.walletStateManager.read();
  // Shape observed in @metamask/agent-wallet 7.0.0: { selectedWallet: { mode, namespace, ref: { address } }, remoteWallets: [...] }
  const candidates = [state?.selectedWallet?.ref?.address, state?.selectedWallet?.address];
  const addr = candidates.find((a) => typeof a === "string" && ADDRESS_RE.test(a));
  if (!addr) throw new Error(`could not find the active wallet address in wallet state (keys: ${Object.keys(state ?? {}).join(", ")})`);
  return addr;
}

const DECIMALS_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

export async function tokenDecimals(ctx: PluginCommandContext, chainId: number, asset: string): Promise<number | null> {
  try {
    const d = await ctx.publicClient(chainId).readContract({ address: asset as `0x${string}`, abi: DECIMALS_ABI, functionName: "decimals" });
    return Number(d);
  } catch {
    return null;
  }
}
