// Formatting utilities for addresses, values, gas, etc.

export function shortAddr(address: string, chars = 4): string {
  if (!address || address.length < 10) return address
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`
}

export function shortHash(hash: string): string {
  if (!hash || hash.length < 12) return hash
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}

/**
 * Format a bigint token amount with given decimals.
 * Shows up to `maxDecimals` significant fractional digits.
 */
export function formatAmount(value: bigint, decimals: number, maxDecimals = 6): string {
  if (value === 0n) return '0'
  const neg = value < 0n
  const abs = neg ? -value : value
  const divisor = 10n ** BigInt(decimals)
  const whole = abs / divisor
  const frac = abs % divisor

  if (frac === 0n) return `${neg ? '-' : ''}${whole.toLocaleString()}`

  const fracStr = frac.toString().padStart(decimals, '0')
  // Trim trailing zeros, cap at maxDecimals
  const trimmed = fracStr.slice(0, maxDecimals).replace(/0+$/, '')
  return `${neg ? '-' : ''}${whole.toLocaleString()}.${trimmed || '0'}`
}

export function formatEth(value: bigint, maxDecimals = 6): string {
  return formatAmount(value, 18, maxDecimals)
}

export function formatGwei(wei: bigint): string {
  const n = Number(wei) / 1e9
  if (n < 0.01) {
    const mwei = Number(wei) / 1e6
    return mwei < 1 ? `${mwei.toFixed(2)} mwei` : `${mwei.toFixed(0)} mwei`
  }
  if (n < 10) return `${n.toFixed(3)} gwei`
  return `${n.toFixed(1)} gwei`
}

export function formatGas(gas: bigint): string {
  const n = Number(gas)
  if (n < 1_000) return n.toString()
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  return `${(n / 1_000_000_000).toFixed(2)}G`
}

/** Compact count: 1234 → "1.2k", 1_500_000 → "1.5M" (no commas) */
export function formatCount(n: number): string {
  if (n < 1_000) return n.toString()
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export function formatNumber(n: number | bigint): string {
  return Number(n).toLocaleString()
}

export function formatPercent(num: number, denom: number, decimals = 1): string {
  if (denom === 0) return '—'
  return `${((num / denom) * 100).toFixed(decimals)}%`
}

export function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatAge(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 5) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

/** CSS color variable for a gas utilization ratio (0–1). */
export function gasColor(ratio: number): string {
  if (ratio > 0.9) return 'var(--red)'
  if (ratio > 0.7) return 'var(--amber)'
  return 'var(--green)'
}

// Hex parsing helpers
export function hexToNumber(hex: string): number {
  return parseInt(hex, 16) || 0
}

export function hexToBigInt(hex: string | undefined | null): bigint {
  if (!hex || hex === '0x' || hex === '0x0') return 0n
  try { return BigInt(hex) } catch { return 0n }
}

export function getSelector(input: string): string | null {
  if (!input || input.length < 10 || input === '0x') return null
  return input.slice(0, 10).toLowerCase()
}

// Signed int256 (two's complement)
export function toSignedBigInt(hex: string): bigint {
  const val = BigInt(hex)
  const max = 2n ** 255n
  return val >= max ? val - 2n ** 256n : val
}

// Extract 20-byte address from 32-byte padded topic
export function topicToAddress(topic: string): string {
  return '0x' + topic.slice(26).toLowerCase()
}

// Decode uint256 at slot `offset` from ABI-encoded data
export function decodeUint256(data: string, offset = 0): bigint {
  const start = 2 + offset * 64
  const slice = data.slice(start, start + 64)
  return slice ? BigInt('0x' + slice) : 0n
}

// Decode int256 at slot `offset` from ABI-encoded data
export function decodeInt256(data: string, offset = 0): bigint {
  const start = 2 + offset * 64
  const hex = '0x' + data.slice(start, start + 64)
  return toSignedBigInt(hex)
}

// Decode address at slot `offset` from ABI-encoded data
export function decodeAddress(data: string, offset = 0): string {
  const start = 2 + offset * 64
  return '0x' + data.slice(start + 24, start + 64).toLowerCase()
}
