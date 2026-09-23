import type { Connection, ParsedTransactionWithMeta } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'

const WSOL = 'So11111111111111111111111111111111111111112'

function firstOutbound(
  parsed: ParsedTransactionWithMeta,
  puller: string,
): { to: string; signature: string } | null {
  const signature = parsed.transaction.signatures[0]
  const keys = parsed.transaction.message.accountKeys.map((k) =>
    typeof k === 'string' ? k : k.pubkey.toBase58(),
  )
  const pre = parsed.meta?.preBalances ?? []
  const post = parsed.meta?.postBalances ?? []
  const pullerIndex = keys.indexOf(puller)
  if (pullerIndex < 0) return null
  if ((post[pullerIndex] ?? 0) >= (pre[pullerIndex] ?? 0)) return null
  let bestTo: string | null = null
  let bestGain = 0
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === puller) continue
    const gain = (post[i] ?? 0) - (pre[i] ?? 0)
    if (gain > bestGain) {
      bestGain = gain
      bestTo = keys[i]
    }
  }
  if (!bestTo || bestGain <= 0) return null
  return { to: bestTo, signature }
}

export async function watchSentOn(
  connection: Connection,
  puller: string,
  removeSignature: string,
  windowMs: number,
): Promise<{ to: string; signature: string } | null> {
  const started = Date.now()
  const seen = new Set<string>([removeSignature])
  while (Date.now() - started < windowMs) {
    const sigs = await connection.getSignaturesForAddress(new PublicKey(puller), {
      limit: 8,
    })
    for (const info of sigs) {
      if (seen.has(info.signature)) continue
      seen.add(info.signature)
      const parsed = await connection.getParsedTransaction(info.signature, {
        maxSupportedTransactionVersion: 0,
      })
      if (!parsed) continue
      const hit = firstOutbound(parsed, puller)
      if (hit) return hit
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  void WSOL
  return null
}
