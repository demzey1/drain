# DRAIN

Live liquidity-pool removals on Solana. Who pulled the LP, how much SOL, whether they already sent it on.

Not a launch feed. Not a trading bot.

Live site: https://drain-jet.vercel.app

## Get a key

Sign up here. Pro is free for 7 days:

https://solami.dev/signup?ref=st-earn-sep-26

In the Solami dashboard, open API Keys. Copy the RPC key into `SOLAMI_RPC_TOKEN`. Copy the gRPC key into `SOLAMI_GRPC_TOKEN`.

## Setup

```bash
git clone https://github.com/demzey1/drain.git
cd drain
npm install
copy .env.example .env.local
```

On Mac or Linux use `cp .env.example .env.local` instead of `copy`.

Paste your two keys into `.env.local`. Leave `DRAIN_PREVIEW` empty. Do not commit `.env.local`.

## Run

Terminal 1:

```bash
npx tsx --env-file=.env.local ingest/index.ts
```

Terminal 2:

```bash
npx next dev
```

Open http://localhost:3000

Then click Open the board.

An empty board that says waiting for a pull is correct until a real remove lands.

Ingest tries `client.grpc().subscribe` once, filtered to liquidity-pool programs. If the key has gRPC, that is the data path. If streaming is denied, it watches those same programs on Solami RPC.

Each row links out:

- solscan opens https://solscan.io/tx/ plus the full signature
- chart opens https://dexscreener.com/solana/ plus the full mint
