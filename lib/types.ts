export type PullEvent = {
  id: string
  mint: string
  name: string | null
  symbol: string | null
  dex: string
  puller: string
  amountSol: number
  amountUsd: number | null
  slot: number
  signature: string
  sentOn: boolean
  sentTo: string | null
  sentSignature: string | null
  ts: number
}
