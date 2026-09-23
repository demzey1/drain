import 'dotenv/config'
import { createRequire } from 'node:module'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { PublicKey, type Connection } from '@solana/web3.js'
import type { PullEvent } from '../lib/types'
import { solUsd, usdFromSol } from '../lib/price'
import { tokenName } from '../lib/token-name'
import { watchSentOn } from './sent-on'
import { LP_PROGRAMS, parseRpcRemove, parseYellowstoneRemove, type RemoveHit } from './remove'

const nodeRequire = createRequire(import.meta.url)

const PORT = Number(process.env.DRAIN_WS_PORT || 8787)
const MIN_SOL = Number(process.env.DRAIN_MIN_SOL || 1)
const SENT_MS = Number(process.env.DRAIN_SENT_ON_MS || 25_000)
const RPC_TOKEN = process.env.SOLAMI_RPC_TOKEN || ''
const GRPC_TOKEN = process.env.SOLAMI_GRPC_TOKEN || ''

if (!GRPC_TOKEN || !RPC_TOKEN) {
  console.error('Missing SOLAMI_GRPC_TOKEN or SOLAMI_RPC_TOKEN in .env.local')
  process.exit(1)
}

const sockets = new Set<WebSocket>()
const seen = new Set<string>()
const scanned = new Set<string>()

function scrub(value: unknown): string {
  const text = value instanceof Error ? `${value.name}: ${value.message}` : String(value)
  return text
    .replace(/api_key=[^&\s]+/gi, 'api_key=***')
    .replaceAll(RPC_TOKEN, '***')
    .replaceAll(GRPC_TOKEN, '***')
}

function broadcast(event: PullEvent) {
  const raw = JSON.stringify(event)
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(raw)
  }
}

function remember(signature: string, bucket: Set<string>) {
  bucket.add(signature)
  if (bucket.size <= 20000) return
  const oldest = bucket.values().next().value
  if (oldest) bucket.delete(oldest)
}

async function emitRemove(hit: RemoveHit) {
  const price = await solUsd()
  const named = await tokenName(hit.mint)
  const event: PullEvent = {
    id: hit.signature,
    mint: hit.mint,
    name: named.name,
    symbol: named.symbol,
    dex: hit.dex,
    puller: hit.puller,
    amountSol: hit.amountSol,
    amountUsd: usdFromSol(hit.amountSol, price),
    slot: hit.slot,
    signature: hit.signature,
    sentOn: false,
    sentTo: null,
    sentSignature: null,
    ts: Date.now(),
  }
  broadcast(event)
  console.log(
    'pull',
    named.symbol || hit.mint,
    hit.amountSol.toFixed(2),
    'SOL',
    hit.signature,
  )

  if (!connection) return
  const rpc = connection
  watchSentOn(rpc, hit.puller, hit.signature, SENT_MS)
    .then((hop) => {
      if (!hop) return
      broadcast({
        ...event,
        sentOn: true,
        sentTo: hop.to,
        sentSignature: hop.signature,
      })
      console.log('sent-on', hop.signature)
    })
    .catch((err) => console.error('sent-on failed', scrub(err)))
}

let connection: Connection | null = null
let request: Record<string, unknown> | null = null

class StreamDenied extends Error {}

function yellowstoneClient(url: string) {
  const fromSolami = createRequire(nodeRequire.resolve('solami'))
  const loaded = fromSolami('@triton-one/yellowstone-grpc') as { default?: new (url: string, token: string, options: undefined) => { _client: { subscribe: (metadata: unknown) => WebSocket & { write: Function; on: Function; destroy: () => void } } } }
  const Yellowstone = loaded.default ?? (loaded as unknown as new (url: string, token: string, options: undefined) => { _client: { subscribe: (metadata: unknown) => { write: (payload: unknown, cb: (err?: Error | null) => void) => void; on: Function; destroy: () => void } } })
  const entry = fromSolami.resolve('@triton-one/yellowstone-grpc')
  const grpc = createRequire(entry)('@grpc/grpc-js') as { Metadata: new () => { add: (key: string, value: string) => void; get: (key: string) => string[] } }
  const client = new Yellowstone(url, GRPC_TOKEN, undefined)
  const metadata = new grpc.Metadata()
  metadata.add('x-token', GRPC_TOKEN)
  return { stream: client._client.subscribe(metadata), metadata }
}

function noteHit(hit: RemoveHit | null) {
  if (!hit || seen.has(hit.signature)) return
  remember(hit.signature, seen)
  void emitRemove(hit).catch((err) => console.error('emit failed', scrub(err)))
}

async function openGrpc(url: string) {
  const { CommitmentLevel, SubscriptionBuilder } = await import('solami')
  if (!request) {
    request = new SubscriptionBuilder()
      .commitment(CommitmentLevel.CONFIRMED)
      .transactions('lp-removes', {
        vote: false,
        failed: false,
        accountInclude: LP_PROGRAMS,
        accountExclude: [],
        accountRequired: [],
      })
      .build()
  }
  const subscribeRequest = request
  const { stream } = yellowstoneClient(url)
  console.log(`solami grpc ${url} filtered tx subscribe (solami@0.1.56 has no Blur method)`)
  let txs = 0
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let denied = ''
    const fail = (err: unknown) => {
      if (settled) return
      settled = true
      stream.destroy()
      if (denied) reject(new StreamDenied(denied))
      else reject(err instanceof Error ? err : new Error(scrub(err)))
    }
    const writeErr = (err?: Error | null) => {
      if (err) fail(err)
    }
    const capture = (md?: { get: (key: string) => string[] }) => {
      const raw = md?.get('grpc-message')?.[0]
      if (!raw) return
      denied = decodeURIComponent(raw.replace(/\+/g, ' '))
    }
    stream.on('metadata', capture)
    stream.write({ ...subscribeRequest, ping: undefined }, writeErr)
    stream.on('data', (msg: {
      ping?: unknown
      transaction?: { transaction?: unknown; slot?: string }
    }) => {
      if (msg.ping && !msg.transaction) {
        stream.write({ ...subscribeRequest, ping: { id: 1 } }, () => {})
        return
      }
      const info = msg.transaction?.transaction
      if (!info) return
      txs += 1
      if (txs === 1 || txs % 500 === 0) console.log(`stream txs ${txs}`)
      noteHit(parseYellowstoneRemove(
        info as Parameters<typeof parseYellowstoneRemove>[0],
        msg.transaction?.slot ?? 0,
        MIN_SOL,
      ))
    })
    stream.on('status', (status: { metadata?: { get: (key: string) => string[] } }) => {
      capture(status.metadata)
    })
    stream.on('error', (err: unknown) => {
      setTimeout(() => fail(err), 50)
    })
    stream.on('end', () => {
      setTimeout(() => fail(new Error(denied || 'stream ended')), 50)
    })
  })
}

async function tailRpc() {
  const rpc = connection
  if (!rpc) throw new Error('Solami RPC is not connected')
  console.log('gRPC streaming is not enabled for this key; watching LP programs on Solami RPC')
  let cursor = 0
  let scannedCount = 0
  for (;;) {
    const program = LP_PROGRAMS[cursor % LP_PROGRAMS.length]
    cursor += 1
    try {
      const sigs = await rpc.getSignaturesForAddress(new PublicKey(program), { limit: 8 }, 'confirmed')
      const fresh = sigs.filter((info) => !info.err && !scanned.has(info.signature)).slice(0, 4)
      for (const info of fresh) {
        if (scanned.has(info.signature)) continue
        remember(info.signature, scanned)
        try {
          const tx = await rpc.getTransaction(info.signature, {
            maxSupportedTransactionVersion: 1,
            commitment: 'confirmed',
          })
          if (!tx) {
            scanned.delete(info.signature)
            continue
          }
          scannedCount += 1
          noteHit(parseRpcRemove(tx, info.signature, MIN_SOL))
        } catch (err) {
          const text = scrub(err)
          if (/429|Too Many Requests/i.test(text)) throw err
          console.error('skip tx', text.slice(0, 180))
        }
        await new Promise((r) => setTimeout(r, 350))
      }
      if (scannedCount > 0 && scannedCount % 20 < 2) console.log(`rpc scanned ${scannedCount}`)
    } catch (err) {
      console.error('rpc tail', scrub(err).slice(0, 220))
      await new Promise((r) => setTimeout(r, 8000))
    }
    await new Promise((r) => setTimeout(r, 1200))
  }
}

async function listenForever() {
  const { builder } = await import('solami')
  let chain = builder().withRpc(RPC_TOKEN).withGrpc(GRPC_TOKEN)
  if (process.env.SOLAMI_RPC_URL) chain = chain.rpcBase(process.env.SOLAMI_RPC_URL)
  if (process.env.SOLAMI_GRPC_URL) chain = chain.grpcUrl(process.env.SOLAMI_GRPC_URL)
  const client = await chain.build()
  connection = client.rpc().connection
  const url = client.grpc().url
  try {
    await openGrpc(url)
  } catch (err) {
    const text = scrub(err)
    if (err instanceof StreamDenied || /plan|gRPC access|permission|denied/i.test(text)) {
      console.error(text)
      await tailRpc()
      return
    }
    console.error('stream error', text)
    await new Promise((r) => setTimeout(r, 2000))
    await listenForever()
  }
}

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('drain ingest\n')
})
const wss = new WebSocketServer({ server: httpServer })
wss.on('connection', (socket) => {
  sockets.add(socket)
  socket.on('close', () => sockets.delete(socket))
})
httpServer.listen(PORT, () => {
  console.log(`drain ingest ws://127.0.0.1:${PORT}`)
  console.log(`min sol ${MIN_SOL}; lp programs ${LP_PROGRAMS.length}`)
})

void listenForever()
