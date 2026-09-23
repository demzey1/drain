export const solscanTx = (signature: string) =>
  `https://solscan.io/tx/${signature}`

export const solscanAccount = (address: string) =>
  `https://solscan.io/account/${address}`

export const chartUrl = (mint: string) =>
  `https://dexscreener.com/solana/${mint}`

export const shorten = (value: string, size = 4) =>
  value.length > size * 2 + 3
    ? `${value.slice(0, size)}...${value.slice(-size)}`
    : value
