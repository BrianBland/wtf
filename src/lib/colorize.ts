/**
 * djb2 hash — works for any string, returns a positive 32-bit integer.
 * Used as the fallback for non-hex keys (e.g. protocol names like "Aave V3").
 */
function djb2(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h, 33) ^ s.charCodeAt(i)
  }
  return h >>> 0 // unsigned 32-bit
}

/**
 * Derive H, S, L seeds from any string key.
 * For hex strings (addresses, selectors) we use byte values directly
 * so that similar addresses still get distinct colors via different byte positions.
 * For arbitrary strings (protocol names, etc.) we fall back to djb2 hashing.
 */
function seedsFromKey(key: string): [number, number, number] {
  const clean = key.toLowerCase().replace('0x', '')
  const isHex = /^[0-9a-f]+$/.test(clean)

  if (isHex && clean.length >= 6) {
    // Use first, middle, and last bytes so short strings (selectors = 8 chars)
    // get a varied hue rather than always inheriting from zero-padding.
    const mid = Math.floor(clean.length / 2) & ~1  // even index near midpoint
    const h = parseInt(clean.slice(0, 2), 16)
    const s = parseInt(clean.slice(mid, mid + 2), 16)
    const l = parseInt(clean.slice(-2), 16)
    return [h, s, l]
  }

  // Arbitrary string: hash it, then spread bits across H/S/L
  const hash = djb2(key)
  return [hash & 0xff, (hash >> 8) & 0xff, (hash >> 16) & 0xff]
}

/**
 * Derive a stable, visually distinct HSL color from any string key.
 * Output colors: saturation 60–85%, lightness 50–70% (readable on dark bg).
 */
export function keyToHsl(key: string): string {
  const [h, s, l] = seedsFromKey(key)
  const hue = Math.floor((h / 256) * 360)
  const sat = 60 + Math.floor((s / 256) * 25)
  const lit = 50 + Math.floor((l / 256) * 20)
  return `hsl(${hue}, ${sat}%, ${lit}%)`
}

/** Kept for callers that expect hexToHsl by name */
export const hexToHsl = keyToHsl

/** Return suitable foreground color for a given HSL background */
export function contrastColor(hsl: string): string {
  const m = hsl.match(/hsl\(\d+,\s*\d+%,\s*(\d+)%\)/)
  if (!m) return '#f0f0f0'
  return parseInt(m[1]) > 58 ? '#0a0a0a' : '#f0f0f0'
}

/** Get background + foreground colors from any key (hex address, selector, name, …) */
export function hexColors(key: string): { bg: string; text: string } {
  const bg = keyToHsl(key)
  return { bg, text: contrastColor(bg) }
}

/** Protocol type → color mapping */
export const PROTOCOL_COLORS: Record<string, string> = {
  dex:     '#00e5ff',
  lending: '#ff9100',
  token:   '#69f0ae',
  bridge:  '#ce93d8',
  other:   '#90a4ae',
}

export const ACTION_COLORS: Record<string, string> = {
  Swap:          '#00e5ff',
  Supply:        '#69f0ae',
  Withdraw:      '#ffab40',
  Borrow:        '#ff7043',
  Repay:         '#aed581',
  Liquidation:   '#ff1744',
  'Flash Loan':  '#e040fb',
  Transfer:      '#90a4ae',
  Wrap:          '#80cbc4',
  Unwrap:        '#80cbc4',
}
