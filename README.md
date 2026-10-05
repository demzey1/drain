# DRAIN

Live liquidity-pool removals on Solana. Who pulled the LP, how much SOL, whether they already sent it on.

Not a launch feed. Not a trading bot.

## Stack

- **Solami gRPC** — one filtered subscribe for liquidity-pool transactions, when the key allows streaming
- **Solami RPC** — poll of those same pool programs when streaming is denied, plus the sent-on watch
- **Jupiter** — SOL/USD
- **Dexscreener** — token name and ticker
- **Next.js board** — `/` landing, `/board` live list
- **Local WebSocket** — ingest process pushes events to the board

## Setup

```bash
cp .env.example .env.local
pnpm install
```

Paste your own `SOLAMI_RPC_TOKEN` and `SOLAMI_GRPC_TOKEN` into `.env.local`. Leave `DRAIN_PREVIEW` empty. Do not commit `.env.local`.

Two terminals:

```bash
pnpm ingest
pnpm dev
```

If `pnpm` is not available, the same processes are:

```bash
npx tsx --env-file=.env.local ingest/index.ts
npx next dev
```

Open [http://localhost:3000](http://localhost:3000) then **Open the board**.

Empty board (`waiting for a pull`) is correct until a real remove lands.

Ingest calls `client.grpc().subscribe` once, filtered to liquidity-pool programs. If the key has gRPC, that subscribe path is the data path. If streaming is denied, the Solami RPC poll of those same programs is the data path. Only real removes at or above `DRAIN_MIN_SOL` are shown. No mocks.

The bounty demo is a 2–3 minute Loom of this local mainnet run. Do not leave a hosted site up.

## Links

Always built from full chain values, never from the shortened label:

- Solscan tx → `https://solscan.io/tx/{signature}`
- Chart → `https://dexscreener.com/solana/{mint}`
- Wallet → `https://solscan.io/account/{address}`

## Bounty notes

Judges paste their own `SOLAMI_RPC_TOKEN` and `SOLAMI_GRPC_TOKEN`. If their key has gRPC, the subscribe path is used. If not, the RPC poll is the data path. No mocks. Record the Loom while a key is valid. Do not leave gRPC running for weeks.
