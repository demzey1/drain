# DRAIN

Live liquidity-pool removals on Solana. Who pulled the LP, how much SOL, whether they already sent it on.

Not a launch feed. Not a trading bot.

## Stack

- **Solami gRPC** — live `liquidity` removes (Blur if the key allows it)
- **Solami RPC** — sent-on watch + any metadata fallback
- **Next.js board** — `/` landing, `/board` live list
- **Local WebSocket** — ingest process pushes events to the board

## Setup

```bash
cp .env.example .env.local
# put SOLAMI_RPC_TOKEN and SOLAMI_GRPC_TOKEN in .env.local
pnpm install
pnpm ingest
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) then **Open the board**.

Empty board (`waiting for a pull`) is correct until a real remove lands.

## Links

Always built from full chain values, never from the shortened label:

- Solscan tx → `https://solscan.io/tx/{signature}`
- Chart → `https://dexscreener.com/solana/{mint}`
- Wallet → `https://solscan.io/account/{address}`

## Bounty notes

Judges use their own Solami keys. Record the Loom while a key is valid. Do not leave gRPC running for weeks.
