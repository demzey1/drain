# DRAIN

Live liquidity-pool removals on Solana. Who pulled the LP, how much SOL, whether they already sent it on.

Not a launch feed. Not a trading bot.

## Setup

```bash
git clone https://github.com/demzey1/drain.git
cd drain
npm install
cp .env.example .env.local
```

Paste your own `SOLAMI_RPC_TOKEN` and `SOLAMI_GRPC_TOKEN` into `.env.local`. Leave `DRAIN_PREVIEW` empty. Do not commit `.env.local`.

## Run

Terminal 1:

```bash
npx tsx --env-file=.env.local ingest/index.ts
```

Terminal 2:

```bash
npx next dev
```

Open http://localhost:3000/board.

An empty board (`waiting for a pull`) is correct until a real remove lands.

Ingest calls `client.grpc().subscribe` once, filtered to liquidity-pool programs. If the key has gRPC, that subscribe path is the data path. If streaming is denied, the Solami RPC poll of those same programs is the data path. Only real removes at or above `DRAIN_MIN_SOL` are shown. No mocks.

## Links

Visible text may be shortened. The href is the full chain value.

- Solscan → `https://solscan.io/tx/{FULL_SIGNATURE}`
- Chart → `https://dexscreener.com/solana/{FULL_MINT}`
