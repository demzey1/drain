const WSOL = 'So11111111111111111111111111111111111111112'
const LAMPORTS_PER_SOL = 1_000_000_000

const DEX_BY_PROGRAM: Record<string, string> = {
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'raydium',
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: 'raydium',
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: 'raydium',
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: 'orca',
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: 'meteora',
  Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB: 'meteora',
  cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG: 'meteora',
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: 'pumpswap',
}

export const LP_PROGRAMS = Object.keys(DEX_BY_PROGRAM)

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++
  const digits = [0]
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8
      digits[j] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }
  let out = '1'.repeat(zeros)
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]]
  return out
}

export type TokenRow = {
  accountIndex: number
  mint: string
  owner: string
  amount: string
  decimals: number
}

export type RemoveHit = {
  mint: string
  puller: string
  signature: string
  slot: number
  dex: string
  amountSol: number
}

type Agg = { raw: bigint; decimals: number }

function lamports(value: string | number | undefined): bigint {
  if (value == null || value === '') return BigInt(0)
  try {
    return BigInt(value)
  } catch {
    return BigInt(0)
  }
}

function ui(agg: Agg): number {
  const scale = 10 ** agg.decimals
  if (!Number.isFinite(scale) || scale <= 0) return 0
  return Number(agg.raw) / scale
}

function dexFor(keys: string[]): string {
  const set = new Set(keys)
  for (const [program, name] of Object.entries(DEX_BY_PROGRAM)) {
    if (set.has(program)) return name
  }
  return 'unknown'
}

/**
 * A remove is the signer taking both sides out of a pool.
 * The signer must gain WSOL (or native SOL) and the other token.
 * A different owner must have lost both. An add or Invest sends both
 * into the pool, so the signer is not the receiver and does not match.
 */
export function parseRemove(input: {
  signature: string
  slot: number
  failed: boolean
  keys: string[]
  preToken: TokenRow[]
  postToken: TokenRow[]
  preBalances: Array<string | number>
  postBalances: Array<string | number>
  minSol: number
}): RemoveHit | null {
  if (input.failed || !input.signature) return null
  const signer = input.keys[0]
  if (!signer) return null
  const minRaw = BigInt(Math.round(input.minSol * LAMPORTS_PER_SOL))
  if (minRaw <= BigInt(0)) return null

  const byMintOwner = new Map<string, Map<string, Agg>>()
  const preByIndex = new Map(input.preToken.map((row) => [row.accountIndex, row]))
  const postByIndex = new Map(input.postToken.map((row) => [row.accountIndex, row]))
  const indexes = new Set<number>([...preByIndex.keys(), ...postByIndex.keys()])
  for (const index of indexes) {
    const pre = preByIndex.get(index)
    const post = postByIndex.get(index)
    const mint = post?.mint || pre?.mint || ''
    const owner = post?.owner || pre?.owner || ''
    const decimals = post?.decimals ?? pre?.decimals ?? 0
    const before = pre ? lamports(pre.amount) : BigInt(0)
    const after = post ? lamports(post.amount) : BigInt(0)
    const delta = after - before
    if (!mint || !owner || delta === BigInt(0)) continue
    let owners = byMintOwner.get(mint)
    if (!owners) {
      owners = new Map()
      byMintOwner.set(mint, owners)
    }
    const prev = owners.get(owner) ?? { raw: BigInt(0), decimals }
    prev.raw += delta
    prev.decimals = decimals
    owners.set(owner, prev)
  }

  const wsolOwners = byMintOwner.get(WSOL)
  const signerIndex = 0
  const nativeDelta =
    lamports(input.postBalances[signerIndex]) - lamports(input.preBalances[signerIndex])
  const nativeGain = nativeDelta > BigInt(0) ? nativeDelta : BigInt(0)
  const signerWsol = wsolOwners?.get(signer)
  const wsolGain = signerWsol && signerWsol.raw > BigInt(0) ? signerWsol.raw : BigInt(0)
  const solRaw = wsolGain + nativeGain
  if (solRaw < minRaw) return null

  let mint = ''
  let mintUi = 0
  for (const [candidate, ownersOfMint] of byMintOwner) {
    if (candidate === WSOL) continue
    const gain = ownersOfMint.get(signer)
    if (!gain || gain.raw <= BigInt(0)) continue
    let poolLostBoth = false
    for (const [owner, agg] of ownersOfMint) {
      if (owner === signer || agg.raw >= BigInt(0)) continue
      const wsol = wsolOwners?.get(owner)
      if (wsol && wsol.raw < BigInt(0)) {
        poolLostBoth = true
        break
      }
    }
    if (!poolLostBoth) continue
    const human = ui(gain)
    if (!mint || human > mintUi) {
      mint = candidate
      mintUi = human
    }
  }
  if (!mint) return null

  return {
    mint,
    puller: signer,
    signature: input.signature,
    slot: input.slot,
    dex: dexFor(input.keys),
    amountSol: Number(solRaw) / LAMPORTS_PER_SOL,
  }
}

type YellowstoneToken = {
  accountIndex?: number
  mint?: string
  owner?: string
  uiTokenAmount?: { amount?: string; decimals?: number }
}

type YellowstoneInfo = {
  signature?: Uint8Array
  meta?: {
    err?: unknown
    preBalances?: Array<string | number>
    postBalances?: Array<string | number>
    preTokenBalances?: YellowstoneToken[]
    postTokenBalances?: YellowstoneToken[]
    loadedWritableAddresses?: Uint8Array[]
    loadedReadonlyAddresses?: Uint8Array[]
  }
  transaction?: { message?: { accountKeys?: Uint8Array[] } }
}

function tokenRows(rows: YellowstoneToken[] | undefined): TokenRow[] {
  const out: TokenRow[] = []
  for (const row of rows ?? []) {
    if (row.accountIndex == null || !row.mint || !row.owner) continue
    out.push({
      accountIndex: row.accountIndex,
      mint: row.mint,
      owner: row.owner,
      amount: row.uiTokenAmount?.amount || '0',
      decimals: row.uiTokenAmount?.decimals ?? 0,
    })
  }
  return out
}

type RpcToken = {
  accountIndex?: number
  mint?: string
  owner?: string
  uiTokenAmount?: { amount?: string; decimals?: number }
}

type RpcResponse = {
  slot?: number
  meta?: {
    err?: unknown
    preBalances?: Array<number | string>
    postBalances?: Array<number | string>
    preTokenBalances?: RpcToken[] | null
    postTokenBalances?: RpcToken[] | null
    loadedAddresses?: {
      writable?: Array<{ toBase58?: () => string } | string>
      readonly?: Array<{ toBase58?: () => string } | string>
    } | null
  } | null
  transaction?: {
    message?: {
      staticAccountKeys?: Array<{ toBase58?: () => string } | string>
      accountKeys?: Array<{ toBase58?: () => string } | string>
      getAccountKeys?: (args: {
        accountKeysFromLookups: RpcResponse['meta'] extends infer M ? M extends { loadedAddresses?: infer L } ? L : null : null
      }) => { length: number; get: (index: number) => { toBase58: () => string } | undefined }
    }
  }
}

function asAddress(value: { toBase58?: () => string } | string | undefined): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value.toBase58?.() ?? ''
}

export function parseRpcRemove(tx: RpcResponse, signature: string, minSol: number): RemoveHit | null {
  const meta = tx.meta
  const message = tx.transaction?.message
  if (!meta || !message) return null
  let keys: string[] = []
  if (typeof message.getAccountKeys === 'function') {
    const list = message.getAccountKeys({
      accountKeysFromLookups: meta.loadedAddresses ?? null,
    })
    for (let i = 0; i < list.length; i++) {
      const key = list.get(i)
      if (key) keys.push(key.toBase58())
    }
  } else {
    keys = [...(message.staticAccountKeys ?? message.accountKeys ?? [])].map((key) => asAddress(key)).filter(Boolean)
    for (const key of meta.loadedAddresses?.writable ?? []) {
      const id = asAddress(key)
      if (id) keys.push(id)
    }
    for (const key of meta.loadedAddresses?.readonly ?? []) {
      const id = asAddress(key)
      if (id) keys.push(id)
    }
  }
  return parseRemove({
    signature,
    slot: tx.slot ?? 0,
    failed: meta.err != null,
    keys,
    preToken: tokenRows(meta.preTokenBalances ?? undefined),
    postToken: tokenRows(meta.postTokenBalances ?? undefined),
    preBalances: meta.preBalances ?? [],
    postBalances: meta.postBalances ?? [],
    minSol,
  })
}

export function parseYellowstoneRemove(
  info: YellowstoneInfo,
  slot: string | number,
  minSol: number,
): RemoveHit | null {
  const signatureBytes = info.signature
  if (!signatureBytes?.length) return null
  const messageKeys = info.transaction?.message?.accountKeys ?? []
  const keys = [
    ...messageKeys,
    ...(info.meta?.loadedWritableAddresses ?? []),
    ...(info.meta?.loadedReadonlyAddresses ?? []),
  ].map((key) => base58Encode(key))
  return parseRemove({
    signature: base58Encode(signatureBytes),
    slot: Number(slot) || 0,
    failed: info.meta?.err != null,
    keys,
    preToken: tokenRows(info.meta?.preTokenBalances),
    postToken: tokenRows(info.meta?.postTokenBalances),
    preBalances: info.meta?.preBalances ?? [],
    postBalances: info.meta?.postBalances ?? [],
    minSol,
  })
}
