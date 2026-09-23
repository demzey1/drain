# Instructions for Grok in the terminal / VS Code

You are continuing DRAIN. Do not invent a new product. Do not add mock/demo pulls unless DRAIN_PREVIEW=1.

## Product
Live Solana liquidity-pool **removes** only. Show who pulled, SOL out, USD, coin name, whether that wallet sent funds on. Chart + Solscan must use **full** mint and signature.

## Do not
- Paste or print API keys
- Seed fake events in production
- Label destinations as Binance/Kraken
- Subscribe to unfiltered gRPC (too expensive)
- Add Beam, trading, wallet connect

## Env
Copy `.env.example` → `.env.local`. Human fills tokens. Both RPC and gRPC keys required.

## Run
```bash
pnpm install
pnpm ingest    # terminal 1 — Solami stream + ws://127.0.0.1:8787
pnpm dev       # terminal 2 — http://localhost:3000
```

Board reads `NEXT_PUBLIC_DRAIN_WS`.

## Where live numbers come from
1. Solami gRPC Blur `liquidity` remove (preferred) or parsed tx token-balance delta for WSOL
2. `lib/price.ts` Jupiter SOL/USD
3. `lib/token-name.ts` Dexscreener symbol/name
4. Solami RPC `getSignaturesForAddress` + parsed tx on the puller for sent-on

## Files to finish first if stream fails
- `ingest/index.ts` — match whatever methods the installed `solami` npm package actually exports (`subscribeBlur`, `subscribe_blur_events`, or raw Yellowstone). Inspect `node_modules/solami` before guessing.
- Filter event type to liquidity **remove** only. Min SOL = `DRAIN_MIN_SOL`.

## UI leftovers
- No `↗` on links
- Board header: `slot · last pull · mute · pause`
- No MAINNET label
- Landing subhead already correct
