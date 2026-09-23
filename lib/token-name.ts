type CacheRow = { name: string | null; symbol: string | null }
const cache = new Map<string, CacheRow>()

export async function tokenName(mint: string): Promise<CacheRow> {
  const hit = cache.get(mint)
  if (hit) return hit
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
    )
    if (!res.ok) {
      cache.set(mint, { name: null, symbol: null })
      return { name: null, symbol: null }
    }
    const json = (await res.json()) as {
      pairs?: Array<{ baseToken?: { name?: string; symbol?: string; address?: string } }>
    }
    const pair = json.pairs?.find((p) => p.baseToken?.address === mint) ?? json.pairs?.[0]
    const row = {
      name: pair?.baseToken?.name ?? null,
      symbol: pair?.baseToken?.symbol ?? null,
    }
    cache.set(mint, row)
    return row
  } catch {
    return { name: null, symbol: null }
  }
}
