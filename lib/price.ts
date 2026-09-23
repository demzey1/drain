const JUPITER_SOL =
  'https://lite-api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112'

let cached: { usd: number; at: number } | null = null

export async function solUsd(): Promise<number | null> {
  const now = Date.now()
  if (cached && now - cached.at < 30_000) return cached.usd
  try {
    const res = await fetch(JUPITER_SOL)
    if (!res.ok) return cached?.usd ?? null
    const json = (await res.json()) as {
      data?: Record<string, { price?: string | number }>
    }
    const raw = json.data?.So11111111111111111111111111111111111111112?.price
    const usd = Number(raw)
    if (!Number.isFinite(usd) || usd <= 0) return cached?.usd ?? null
    cached = { usd, at: now }
    return usd
  } catch {
    return cached?.usd ?? null
  }
}

export function usdFromSol(sol: number, price: number | null): number | null {
  if (price == null) return null
  return Math.round(sol * price * 100) / 100
}
