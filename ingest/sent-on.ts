import type { Connection } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'

type AddressLike = { toBase58?: () => string } | string

type RawTx = {
  meta?: {
    preBalances?: Array<number | string>
    postBalances?: Array<number | string>
    loadedAddresses?: {
      writable?: AddressLike[]
      readonly?: AddressLike[]
    } | null
  } | null
  transaction: {
    message: {
      staticAccountKeys?: AddressLike[]
      accountKeys?: AddressLike[]
      getAccountKeys?: (args: { accountKeysFromLookups: unknown }) => {
        length: number
        get: (index: number) => { toBase58: () => string } | undefined
      }
    }
  }
}

function asAddress(value: AddressLike | undefined): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value.toBase58?.() ?? ''
}

function accountKeys(tx: RawTx): string[] {
  const message = tx.transaction.message
  const loaded = tx.meta?.loadedAddresses ?? null
  if (typeof message.getAccountKeys === 'function') {
    const list = message.getAccountKeys({ accountKeysFromLookups: loaded })
    const keys: string[] = []
    for (let i = 0; i < list.length; i++) {
      const key = list.get(i)
      if (key) keys.push(key.toBase58())
    }
    if (keys.length) return keys
  }
  const keys = [...(message.staticAccountKeys ?? message.accountKeys ?? [])]
    .map((key) => asAddress(key))
    .filter(Boolean)
  for (const key of loaded?.writable ?? []) {
    const id = asAddress(key)
    if (id) keys.push(id)
  }
  for (const key of loaded?.readonly ?? []) {
    const id = asAddress(key)
    if (id) keys.push(id)
  }
  return keys
}

function lamports(value: number | string | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function firstOutbound(
  tx: RawTx,
  signature: string,
  puller: string,
): { to: string; signature: string } | null {
  const keys = accountKeys(tx)
  const pre = tx.meta?.preBalances ?? []
  const post = tx.meta?.postBalances ?? []
  const pullerIndex = keys.indexOf(puller)
  if (pullerIndex < 0) return null
  if (lamports(post[pullerIndex]) >= lamports(pre[pullerIndex])) return null
  let bestTo: string | null = null
  let bestGain = 0
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === puller) continue
    const gain = lamports(post[i]) - lamports(pre[i])
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
      try {
        const tx = await connection.getTransaction(info.signature, {
          maxSupportedTransactionVersion: 1,
          commitment: 'confirmed',
        })
        if (!tx?.meta) continue
        const hit = firstOutbound(tx, info.signature, puller)
        if (hit) return hit
      } catch {
        continue
      }
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return null
}
