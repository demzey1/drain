import 'dotenv/config'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { PublicKey, type Connection } from '@solana/web3.js'
import type { PullEvent } from '../lib/types'
import { solUsd, usdFromSol } from '../lib/price'
import { tokenName } from '../lib/token-name'
import { watchSentOn } from './sent-on'
import type { GrpcStream } from 'solami'
import { LP_PROGRAMS, parseRpcRemove, parseYellowstoneRemove, type RemoveHit } from './remove'

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
  watchSentOn(connection, hit.puller, hit.signature, SENT_MS)
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
let grpcStream: GrpcStream | null = null

function noteHit(hit: RemoveHit | null) {
  if (!hit || seen.has(hit.signature)) return
  remember(hit.signature, seen)
  void emitRemove(hit).catch((err) => console.error('emit failed', scrub(err)))
}

async function openGrpcStream(client: {
  grpc: () => {
    url: string
    subscribe: (request: any) => Promise<GrpcStream>
  }
}) {
  const { CommitmentLevel, SubscriptionBuilder } = await import('solami')
  const request = new SubscriptionBuilder()
    .commitment(CommitmentLevel.CONFIRMED)
    .transactions('lp-removes', {
      vote: false,
      failed: false,
      accountInclude: LP_PROGRAMS,
      accountExclude: [],
      accountRequired: [],
    })
    .build()
  const grpc = client.grpc()
  console.log(
    `solami grpc ${grpc.url} client.grpc().subscribe lp-removes (${LP_PROGRAMS.length} LP programs). solami@0.1.56 has no Blur method`,
  )
  let txs = 0
  const stream = await grpc.subscribe(request)
  grpcStream = stream
  await new Promise<void>((_resolve, reject) => {
    let settled = false
    let denied = ''
    const fail = (err: unknown) => {
      if (settled) return
      settled = true
      grpcStream?.destroy()
      if (denied) reject(new Error(denied))
      else reject(err instanceof Error ? err : new Error(scrub(err)))
    }
    const capture = (md?: { get: (key: string) => string[] }) => {
      const raw = md?.get('grpc-message')?.[0]
      if (!raw) return
      denied = decodeURIComponent(raw.replace(/\+/g, ' '))
    }
    stream.on('metadata', capture)
    stream.on('data', (msg: {
      ping?: { id?: number }
      transaction?: {
        transaction?: Parameters<typeof parseYellowstoneRemove>[0]
        slot?: string
      }
    }) => {
      if (msg.ping && !msg.transaction) {
        stream.write({ ...request, ping: { id: msg.ping.id ?? 1 } }, () => {})
        return
      }
      const info = msg.transaction?.transaction
      if (!info) return
      txs += 1
      if (txs === 1 || txs % 500 === 0) console.log(`stream txs ${txs}`)
      noteHit(parseYellowstoneRemove(info, msg.transaction?.slot ?? 0, MIN_SOL))
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

async function backfill() {
  const rpc = connection
  if (!rpc) return
  let found = 0
  for (const program of LP_PROGRAMS) {
    try {
      const sigs = await rpc.getSignaturesForAddress(new PublicKey(program), { limit: 40 }, 'confirmed')
      for (const info of sigs) {
        if (info.err || seen.has(info.signature) || scanned.has(info.signature)) continue
        remember(info.signature, scanned)
        try {
          const tx = await rpc.getTransaction(info.signature, {
            maxSupportedTransactionVersion: 1,
            commitment: 'confirmed',
          })
          if (!tx) continue
          const hit = parseRpcRemove(tx as Parameters<typeof parseRpcRemove>[0], info.signature, MIN_SOL)
          if (hit) {
            found += 1
            noteHit(hit)
          }
        } catch (err) {
          console.error('backfill skip', scrub(err).slice(0, 160))
        }
        await new Promise((r) => setTimeout(r, 200))
      }
    } catch (err) {
      console.error('backfill', scrub(err).slice(0, 180))
    }
  }
  console.log(`backfill ${found} pulls`)
}

async function tailRpc() {
  const rpc = connection
  if (!rpc) throw new Error('Solami RPC is not connected')
  console.log('gRPC streaming not available for this key; watching LP programs on Solami RPC')
  await backfill()
  let cursor = 0
  let scannedCount = 0
  for (;;) {
    const program = LP_PROGRAMS[cursor % LP_PROGRAMS.length]
    cursor += 1
    try {
      const sigs = await rpc.getSignaturesForAddress(new PublicKey(program), { limit: 8 }, 'confirmed')
      const fresh = sigs
        .filter((info) => !info.err && !seen.has(info.signature) && !scanned.has(info.signature))
        .slice(0, 4)
      for (const info of fresh) {
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
          noteHit(parseRpcRemove(tx as Parameters<typeof parseRpcRemove>[0], info.signature, MIN_SOL))
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
  try {
    await openGrpcStream(client)
  } catch (err) {
    const text = scrub(err)
    if (/plan|gRPC access|permission|denied/i.test(text)) {
      console.error(text)
      await tailRpc()
      return
    }
    console.error('stream error', text)
    await tailRpc()
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
