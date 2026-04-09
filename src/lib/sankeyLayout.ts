/**
 * Shared Sankey layout types and utilities used by MetaSankeyView and PoolFlowView.
 */
import { USDC, WETH, CBBTC } from './metaFlow'
import { KNOWN_PROTOCOLS, KNOWN_TOKENS } from './protocols'
import { shortAddr } from './formatters'
import { compareBigIntDesc } from './bigintMath'

// ── Constants ─────────────────────────────────────────────────────────────────

export const NODE_W     = 14
export const NODE_GAP   = 6
export const MIN_NODE_H = 10
export const PAD_Y      = 24

export const TOKEN_COLORS = {
  usdc: '#4caf7d',
  weth: '#7eb8f7',
  cbtc: '#f7931a',
} as const

// ── Helpers ───────────────────────────────────────────────────────────────────

export function fmtUSD(usdish: bigint): string {
  const cents = Number(usdish) / 10_000     // µUSDC → cents
  const dollars = cents / 100               // cents → dollars
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`
  if (dollars >= 1_000)     return `$${(dollars / 1_000).toFixed(1)}k`
  return `$${dollars.toFixed(2)}`
}

/**
 * Convert a token amount to micro-USD for proportional sizing.
 * Known tokens use live prices; unknown tokens assume 18 decimals at $1/token.
 */
export function tokenToUSDish(
  addr: string,
  amount: bigint,
  ethPriceUSD = 2500,
  btcPriceUSD = 100_000,
): bigint {
  if (addr === USDC)  return amount
  // ETH: 18 dec → µUSD = amount * price / 1e12
  if (addr === WETH)  return amount * BigInt(Math.round(ethPriceUSD)) / 1_000_000_000_000n
  // cbBTC: 8 dec → µUSD = amount * price / 100
  if (addr === CBBTC) return amount * BigInt(Math.round(btcPriceUSD)) / 100n
  // Unknown token: assume 18 decimals at ~$1
  return amount / 1_000_000_000_000n
}

/** Stable token color — falls back to caller-provided keyToHsl(addr) for unknowns. */
export function knownTokenColor(addr: string): string | null {
  if (addr === USDC)  return TOKEN_COLORS.usdc
  if (addr === WETH)  return TOKEN_COLORS.weth
  if (addr === CBBTC) return TOKEN_COLORS.cbtc
  return null
}

/** Human-readable label for an address (protocol name / token symbol / short hex). */
export function addrLabel(addr: string): string {
  const proto = KNOWN_PROTOCOLS[addr]
  if (proto) return proto.name
  const tok = KNOWN_TOKENS[addr]
  if (tok) return tok.symbol
  return shortAddr(addr, 4)
}

/** Closed bezier ribbon path between two vertical segments. */
export function bandPath(
  sx: number, sy0: number, sy1: number,
  tx: number, ty0: number, ty1: number,
): string {
  const cx = (sx + tx) / 2
  return [
    `M ${sx} ${sy0}`,
    `C ${cx} ${sy0}, ${cx} ${ty0}, ${tx} ${ty0}`,
    `L ${tx} ${ty1}`,
    `C ${cx} ${ty1}, ${cx} ${sy1}, ${sx} ${sy1}`,
    'Z',
  ].join(' ')
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SankeyNode {
  id:       string
  totalUSD: bigint
}

export interface SankeyBand {
  color:      string
  /** Display amount in µUSDC (already net-subtracted in net mode). */
  usd:        bigint
  /** Matched (roundtrip) amount in µUSDC — for dim-highlighting in total mode. */
  matchedUSD: bigint
  /** Short tooltip line, e.g. "USDC 1,234.56" */
  title:      string
}

export interface SankeyEdge {
  fromId:   string
  toId:     string
  /** Sum of band.usd — used for proportional node height allocation. */
  totalUSD: bigint
  bands:    SankeyBand[]
}

export interface LNode extends SankeyNode {
  x:         number
  y:         number
  h:         number
  color:     string
  label:     string
  outCursor: number
  inCursor:  number
}

export interface LEdge {
  sy0: number; sy1: number   // source band top/bottom in SVG coords
  ty0: number; ty1: number   // target band top/bottom in SVG coords
  sx:  number; tx: number    // source/target x positions
  color:           string
  band:            SankeyBand
  edge:            SankeyEdge
  /** Fraction [0–1] of this band that is "roundtrip" (shown dimmer in total mode). */
  matchedFraction: number
}

// ── Layout ────────────────────────────────────────────────────────────────────

export function layoutColumn(
  nodes:       SankeyNode[],
  x:           number,
  totalHeight: number,
  getColor:    (id: string) => string,
  getLabel:    (id: string) => string,
): LNode[] {
  const total  = nodes.reduce((s, n) => s + n.totalUSD, 0n)
  const availH = totalHeight - NODE_GAP * Math.max(0, nodes.length - 1)

  let y = PAD_Y
  return nodes.map((n) => {
    const h = Math.max(MIN_NODE_H, total > 0n
      ? Math.round(Number(n.totalUSD) / Number(total) * availH)
      : MIN_NODE_H)
    const node: LNode = { ...n, x, y, h, color: getColor(n.id), label: getLabel(n.id), outCursor: 0, inCursor: 0 }
    y += h + NODE_GAP
    return node
  })
}

export function allocateEdges(
  edges:     SankeyEdge[],
  fromNodes: LNode[],
  toNodes:   LNode[],
  sx:        number,
  tx:        number,
): LEdge[] {
  const fromTotal = new Map<string, bigint>()
  const toTotal   = new Map<string, bigint>()
  for (const e of edges) {
    fromTotal.set(e.fromId, (fromTotal.get(e.fromId) ?? 0n) + e.totalUSD)
    toTotal.set(e.toId,     (toTotal.get(e.toId)     ?? 0n) + e.totalUSD)
  }

  const fromMap = new Map(fromNodes.map((n) => [n.id, n]))
  const toMap   = new Map(toNodes.map((n)   => [n.id, n]))
  const sorted  = [...edges].sort((a, b) => compareBigIntDesc(a.totalUSD, b.totalUSD))

  const result: LEdge[] = []
  for (const e of sorted) {
    const from = fromMap.get(e.fromId)
    const to   = toMap.get(e.toId)
    if (!from || !to) continue

    const fTotal = fromTotal.get(e.fromId) ?? 1n
    const tTotal = toTotal.get(e.toId)     ?? 1n
    const fH = Math.max(1, Math.round(Number(e.totalUSD) / Number(fTotal) * from.h))
    const tH = Math.max(1, Math.round(Number(e.totalUSD) / Number(tTotal) * to.h))

    const displayTotal = e.bands.reduce((s, b) => s + b.usd, 0n) || 1n
    let fCursor = from.outCursor
    let tCursor = to.inCursor

    for (const band of e.bands) {
      if (band.usd === 0n) continue
      const fh = Math.max(1, Math.round(Number(band.usd) / Number(displayTotal) * fH))
      const th = Math.max(1, Math.round(Number(band.usd) / Number(displayTotal) * tH))
      const matchedFraction = Math.min(1, Number(band.matchedUSD) / Number(band.usd))
      result.push({
        sy0: from.y + fCursor, sy1: from.y + fCursor + fh,
        ty0: to.y   + tCursor, ty1: to.y   + tCursor + th,
        sx, tx,
        color: band.color,
        band, edge: e,
        matchedFraction,
      })
      fCursor += fh
      tCursor += th
    }

    from.outCursor += fH
    to.inCursor    += tH
  }
  return result
}
