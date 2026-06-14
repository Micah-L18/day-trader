export const usd = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export const pct = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

export const signedUsd = (n: number): string => `${n >= 0 ? '+' : '-'}${usd(Math.abs(n))}`

export const num = (n: number): string => n.toLocaleString('en-US')
