import { Block } from '../types'
import { KNOWN_TOKENS } from './protocols'

// ── Value normalization ────────────────────────────────────────────────────
// All values in "micro-USDC" units (1 USDC = 1_000_000 units)

export const USDC  = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
export const WETH  = '0x4200000000000000000000000000000000000006'
export const CBBTC = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'

// WETH: ~$2500. 1 wei → micro-USDC = wei * 25 / 10_000_000_000
// Check: 1e18 * 25 / 1e10 = 2.5e9 µUSDC = $2500 ✓
function wethToUSDish(wei: bigint): bigint {
  return wei * 25n / 10_000_000_000n
}

// cbBTC: ~$100k. 1 sat (1e-8 BTC) → micro-USDC = sats * 1000
// Check: 1e8 sats * 1000 = 1e11 µUSDC = $100,000 ✓
function cbBTCToUSDish(sats: bigint): bigint {
  return sats * 1_000n
}

export function toUSDish(usdcAmt: bigint, wethAmt: bigint, cbBTCAmt: bigint): bigint {
  return usdcAmt + wethToUSDish(wethAmt) + cbBTCToUSDish(cbBTCAmt)
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface MetaNode {
  id:       string
  totalUSD: bigint  // micro-USDC for sizing
}

export interface MetaEdge {
  fromId:       string
  toId:         string
  usdcAmt:      bigint
  wethAmt:      bigint
  cbBTCAmt:     bigint
  /**
   * Other ERC-20 flows by token address → RAW token amounts (native decimals).
   * Sorted descending by approximate µUSD value at construction time.
   * The view layer applies live prices to convert to display µUSD.
   */
  otherTokens:  Map<string, bigint>
  totalUSD:     bigint
  // Raw matched amounts (min of this flow vs reverse). Always in original token units.
  // In net mode these are still stored; usdcAmt etc. are already net (total - matched).
  matchedUsdc:  bigint
  matchedWeth:  bigint
  matchedCbtc:  bigint
}

export interface MetaFlowGraph {
  senders:      MetaNode[]
  pools:         MetaNode[]
  recipients:   MetaNode[]
  senderToPool: MetaEdge[]
  poolToRecip:  MetaEdge[]
}

// ── Build ──────────────────────────────────────────────────────────────────

/**
 * Convert a KNOWN_TOKEN amount to µUSD assuming ~$1/token, using its declared decimals.
 * Returns 0n for tokens not in KNOWN_TOKENS to avoid wild overestimates from the
 * $1 assumption applied to cheap or exotic tokens with unknown prices.
 * ETH-priced tokens (cbETH, wstETH, etc.) are still $1 here — the view layer
 * applies live ETH price when rendering bands.
 */
function otherToUSDish(token: string, amt: bigint): bigint {
  const info = KNOWN_TOKENS[token]
  if (!info) return 0n
  const dec = info.decimals
  // µUSD = amount * $1 * 10^6 / 10^dec = amount * 10^(6-dec)
  if (dec >= 6) return dec === 6 ? amt : amt / (10n ** BigInt(dec - 6))
  return amt * (10n ** BigInt(6 - dec))
}

export function buildMetaFlow(
  blocks: Block[],
  poolAddrs: Set<string>,
  { maxSenders = 12, maxRecipients = 12, maxPools = 10, netMode = false } = {},
): MetaFlowGraph {
  type Acc = { usdc: bigint; weth: bigint; cbtc: bigint; other: Map<string, bigint> }
  type FlowAcc = Map<string, Map<string, Acc>>

  const addFlow = (acc: FlowAcc, from: string, to: string, token: string, amt: bigint) => {
    if (!acc.has(from)) acc.set(from, new Map())
    const inner = acc.get(from)!
    if (!inner.has(to)) inner.set(to, { usdc: 0n, weth: 0n, cbtc: 0n, other: new Map() })
    const e = inner.get(to)!
    if (token === USDC)       e.usdc += amt
    else if (token === WETH)  e.weth += amt
    else if (token === CBBTC) e.cbtc += amt
    else {
      e.other.set(token, (e.other.get(token) ?? 0n) + amt)
    }
  }

  const sToP: FlowAcc = new Map()
  const pToR: FlowAcc = new Map()

  for (const block of blocks) {
    for (const tx of block.transactions) {
      for (const flow of tx.tokenFlows) {
        if (poolAddrs.has(flow.to))   addFlow(sToP, flow.from, flow.to,   flow.token, flow.amount)
        if (poolAddrs.has(flow.from)) addFlow(pToR, flow.from, flow.to,   flow.token, flow.amount)
      }
    }
  }

  // ── Pool totals ──
  // Convert raw "other" amount map to µUSD for ranking purposes ($1/token approx)
  const otherRawToUSD = (other: Map<string, bigint>) => {
    let o = 0n
    for (const [addr, rawAmt] of other) o += otherToUSDish(addr, rawAmt)
    return o
  }

  const poolTotals = new Map<string, bigint>()
  const sumAcc = (rs: Map<string, Acc>) => {
    let u = 0n, w = 0n, c = 0n, o = 0n
    for (const v of rs.values()) {
      u += v.usdc; w += v.weth; c += v.cbtc
      o += otherRawToUSD(v.other)
    }
    return toUSDish(u, w, c) + o
  }
  for (const [pool, rs] of pToR) poolTotals.set(pool, sumAcc(rs))
  for (const [, poolMap] of sToP) {
    for (const [pool, acc] of poolMap) {
      if (!poolTotals.has(pool)) {
        poolTotals.set(pool, toUSDish(acc.usdc, acc.weth, acc.cbtc) + otherRawToUSD(acc.other))
      }
    }
  }

  const topPools = [...poolTotals.entries()]
    .sort((a, b) => Number(b[1] - a[1]))
    .slice(0, maxPools)
  const topPoolIds = new Set(topPools.map(([id]) => id))

  // ── Flatten edges ──
  const bigMin = (a: bigint, b: bigint) => a < b ? a : b

  /** Sort a token→rawAmt map descending by approximate µUSD value. */
  const sortedOther = (m: Map<string, bigint>) =>
    new Map([...m.entries()].sort((a, b) =>
      Number(otherToUSDish(b[0], b[1]) - otherToUSDish(a[0], a[1]))))

  const sPEdges: MetaEdge[] = []
  const senderTotals = new Map<string, bigint>()
  for (const [from, poolMap] of sToP) {
    for (const [pool, acc] of poolMap) {
      if (!topPoolIds.has(pool)) continue
      // Reverse: what did this pool pay back to this sender?
      const rev = pToR.get(pool)?.get(from)
      const matchedUsdc = rev ? bigMin(acc.usdc, rev.usdc) : 0n
      const matchedWeth = rev ? bigMin(acc.weth, rev.weth) : 0n
      const matchedCbtc = rev ? bigMin(acc.cbtc, rev.cbtc) : 0n
      const usdcAmt  = netMode ? acc.usdc - matchedUsdc : acc.usdc
      const wethAmt  = netMode ? acc.weth - matchedWeth  : acc.weth
      const cbBTCAmt = netMode ? acc.cbtc - matchedCbtc  : acc.cbtc
      const otherTokens = sortedOther(acc.other)
      const e: MetaEdge = {
        fromId: from, toId: pool,
        usdcAmt, wethAmt, cbBTCAmt, otherTokens,
        totalUSD: toUSDish(usdcAmt, wethAmt, cbBTCAmt) + otherRawToUSD(otherTokens),
        matchedUsdc, matchedWeth, matchedCbtc,
      }
      if (e.totalUSD === 0n) continue
      sPEdges.push(e)
      senderTotals.set(from, (senderTotals.get(from) ?? 0n) + e.totalUSD)
    }
  }

  const pREdges: MetaEdge[] = []
  const recipTotals = new Map<string, bigint>()
  for (const [pool, recipMap] of pToR) {
    if (!topPoolIds.has(pool)) continue
    for (const [to, acc] of recipMap) {
      // Reverse: what did this recipient send into this pool?
      const rev = sToP.get(to)?.get(pool)
      const matchedUsdc = rev ? bigMin(acc.usdc, rev.usdc) : 0n
      const matchedWeth = rev ? bigMin(acc.weth, rev.weth) : 0n
      const matchedCbtc = rev ? bigMin(acc.cbtc, rev.cbtc) : 0n
      const usdcAmt  = netMode ? acc.usdc - matchedUsdc : acc.usdc
      const wethAmt  = netMode ? acc.weth - matchedWeth  : acc.weth
      const cbBTCAmt = netMode ? acc.cbtc - matchedCbtc  : acc.cbtc
      const otherTokens = sortedOther(acc.other)
      const e: MetaEdge = {
        fromId: pool, toId: to,
        usdcAmt, wethAmt, cbBTCAmt, otherTokens,
        totalUSD: toUSDish(usdcAmt, wethAmt, cbBTCAmt) + otherRawToUSD(otherTokens),
        matchedUsdc, matchedWeth, matchedCbtc,
      }
      if (e.totalUSD === 0n) continue
      pREdges.push(e)
      recipTotals.set(to, (recipTotals.get(to) ?? 0n) + e.totalUSD)
    }
  }

  const topSenderIds = new Set(
    [...senderTotals.entries()].sort((a, b) => Number(b[1] - a[1])).slice(0, maxSenders).map(([id]) => id)
  )
  const topRecipIds = new Set(
    [...recipTotals.entries()].sort((a, b) => Number(b[1] - a[1])).slice(0, maxRecipients).map(([id]) => id)
  )

  return {
    senders:      [...topSenderIds].map(id => ({ id, totalUSD: senderTotals.get(id) ?? 0n })).sort((a, b) => Number(b.totalUSD - a.totalUSD)),
    pools:        topPools.map(([id, totalUSD]) => ({ id, totalUSD })),
    recipients:   [...topRecipIds].map(id => ({ id, totalUSD: recipTotals.get(id) ?? 0n })).sort((a, b) => Number(b.totalUSD - a.totalUSD)),
    senderToPool: sPEdges.filter(e => topSenderIds.has(e.fromId)),
    poolToRecip:  pREdges.filter(e => topRecipIds.has(e.toId)),
  }
}
