import { useMemo, useState } from 'react'
import { Block } from '../types'
import { useStore, Store } from '../store'
import { computePoolFlows, AddrTokenFlow } from '../lib/poolFlow'
import { PoolMeta } from '../lib/poolFetch'
import { KNOWN_TOKENS } from '../lib/protocols'
import { shortAddr, formatAmount, formatEth } from '../lib/formatters'
import { keyToHsl } from '../lib/colorize'
import { USDC, WETH, CBBTC } from '../lib/metaFlow'
import {
  NODE_W, NODE_GAP, MIN_NODE_H, PAD_Y, TOKEN_COLORS,
  fmtUSD, addrLabel, bandPath, layoutColumn, allocateEdges,
  tokenToUSDish, knownTokenColor,
  SankeyEdge, SankeyBand, SankeyNode, LEdge,
} from '../lib/sankeyLayout'

// ── Layout constants ──────────────────────────────────────────────────────────

const W       = 760
const LABEL_W = 140
const COL_L   = LABEL_W
const COL_M   = W / 2 - NODE_W / 2
const COL_R   = W - LABEL_W - NODE_W
const MAX_ADDRS = 10

// ── Helpers ───────────────────────────────────────────────────────────────────

function tokenSym(addr: string, tokenCache: Store['tokenCache']): string {
  const known = KNOWN_TOKENS[addr]
  if (known) return known.symbol
  const cached = tokenCache.get(addr)
  if (cached && typeof cached === 'object') return cached.symbol
  return addr.slice(2, 6).toUpperCase()
}

function fmtAmt(tokenAddr: string, amount: bigint): string {
  if (amount === 0n) return ''
  if (tokenAddr === USDC)  return '$' + formatAmount(amount, 6, 2)
  if (tokenAddr === WETH)  return formatEth(amount, 4) + 'Ξ'
  if (tokenAddr === CBBTC) return formatAmount(amount, 8, 6) + '₿'
  return formatAmount(amount, 18, 4)
}

function bandTitle(tokenAddr: string, amount: bigint): string {
  if (tokenAddr === USDC)  return `USDC ${formatAmount(amount, 6, 2)}`
  if (tokenAddr === WETH)  return `WETH ${formatEth(amount, 4)}`
  if (tokenAddr === CBBTC) return `cbBTC ${formatAmount(amount, 8, 6)}`
  return `${tokenAddr.slice(2, 6).toUpperCase()} ${formatAmount(amount, 18, 4)}`
}

function poolTokenColor(addr: string): string {
  return knownTokenColor(addr) ?? keyToHsl(addr)
}

const bigMin = (a: bigint, b: bigint) => a < b ? a : b

// ── Build SankeyEdges from PoolFlows ──────────────────────────────────────────

interface PoolSankeyData {
  leftEdges:  SankeyEdge[]
  rightEdges: SankeyEdge[]
  leftNodes:  SankeyNode[]
  rightNodes: SankeyNode[]
  poolNode:   SankeyNode
}

function buildPoolSankey(
  t0Flows: Map<string, AddrTokenFlow>,
  t1Flows: Map<string, AddrTokenFlow>,
  token0: string,
  token1: string,
  poolAddr: string,
  showNet: boolean,
  ethPriceUSD: number,
  btcPriceUSD: number,
): PoolSankeyData {
  const allAddrs = new Set([...t0Flows.keys(), ...t1Flows.keys()])

  const leftEdgesRaw:  SankeyEdge[] = []
  const rightEdgesRaw: SankeyEdge[] = []

  for (const addr of allAddrs) {
    const f0 = t0Flows.get(addr)
    const f1 = t1Flows.get(addr)

    // ── Left edge: addr → pool (amountIn) ──
    const leftBands: SankeyBand[] = []
    for (const [tAddr, f] of [[token0, f0], [token1, f1]] as [string, AddrTokenFlow | undefined][]) {
      if (!f || !tAddr || f.amountIn === 0n) continue
      const matched    = bigMin(f.amountIn, f.amountOut)
      const display    = showNet ? f.amountIn - matched : f.amountIn
      const usd        = tokenToUSDish(tAddr, display, ethPriceUSD, btcPriceUSD)
      const matchedUSD = tokenToUSDish(tAddr, matched, ethPriceUSD, btcPriceUSD)
      if (usd === 0n) continue
      leftBands.push({ color: poolTokenColor(tAddr), usd, matchedUSD, title: bandTitle(tAddr, display) })
    }
    if (leftBands.length > 0) {
      const total = leftBands.reduce((s, b) => s + b.usd, 0n)
      if (total > 0n) leftEdgesRaw.push({ fromId: addr, toId: poolAddr, totalUSD: total, bands: leftBands })
    }

    // ── Right edge: pool → addr (amountOut) ──
    const rightBands: SankeyBand[] = []
    for (const [tAddr, f] of [[token0, f0], [token1, f1]] as [string, AddrTokenFlow | undefined][]) {
      if (!f || !tAddr || f.amountOut === 0n) continue
      const matched    = bigMin(f.amountIn, f.amountOut)
      const display    = showNet ? f.amountOut - matched : f.amountOut
      const usd        = tokenToUSDish(tAddr, display, ethPriceUSD, btcPriceUSD)
      const matchedUSD = tokenToUSDish(tAddr, matched, ethPriceUSD, btcPriceUSD)
      if (usd === 0n) continue
      rightBands.push({ color: poolTokenColor(tAddr), usd, matchedUSD, title: bandTitle(tAddr, display) })
    }
    if (rightBands.length > 0) {
      const total = rightBands.reduce((s, b) => s + b.usd, 0n)
      if (total > 0n) rightEdgesRaw.push({ fromId: poolAddr, toId: addr, totalUSD: total, bands: rightBands })
    }
  }

  // Take top N by totalUSD
  leftEdgesRaw.sort((a, b)  => Number(b.totalUSD - a.totalUSD))
  rightEdgesRaw.sort((a, b) => Number(b.totalUSD - a.totalUSD))
  const leftEdges  = leftEdgesRaw.slice(0, MAX_ADDRS)
  const rightEdges = rightEdgesRaw.slice(0, MAX_ADDRS)

  // Build node lists from filtered edges
  const leftNodeMap  = new Map<string, bigint>()
  const rightNodeMap = new Map<string, bigint>()
  for (const e of leftEdges)  leftNodeMap.set(e.fromId, (leftNodeMap.get(e.fromId) ?? 0n) + e.totalUSD)
  for (const e of rightEdges) rightNodeMap.set(e.toId,  (rightNodeMap.get(e.toId)  ?? 0n) + e.totalUSD)

  const leftNodes:  SankeyNode[] = [...leftNodeMap.entries()]
    .sort((a, b) => Number(b[1] - a[1])).map(([id, totalUSD]) => ({ id, totalUSD }))
  const rightNodes: SankeyNode[] = [...rightNodeMap.entries()]
    .sort((a, b) => Number(b[1] - a[1])).map(([id, totalUSD]) => ({ id, totalUSD }))

  const poolTotal = leftNodes.reduce((s, n) => s + n.totalUSD, 0n)

  return { leftEdges, rightEdges, leftNodes, rightNodes, poolNode: { id: poolAddr, totalUSD: poolTotal } }
}

// ── Main component ─────────────────────────────────────────────────────────

export function PoolFlowView({
  blocks, poolAddr, meta,
}: {
  blocks: Block[]
  poolAddr: string
  meta: PoolMeta
}) {
  const { tokenCache, fetchToken, ethPriceUSD, btcPriceUSD } = useStore()
  const [showNet,    setShowNet]    = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useMemo(() => {
    if (meta.token0) fetchToken(meta.token0)
    if (meta.token1) fetchToken(meta.token1)
  }, [meta.token0, meta.token1, fetchToken])

  const flows = useMemo(
    () => computePoolFlows(blocks, poolAddr, meta.token0, meta.token1),
    [blocks, poolAddr, meta.token0, meta.token1]
  )

  const t0sym = tokenSym(meta.token0, tokenCache)
  const t1sym = tokenSym(meta.token1, tokenCache)

  const { leftEdges, rightEdges, leftNodes, rightNodes, poolNode } = useMemo(
    () => buildPoolSankey(flows.token0Flows, flows.token1Flows, flows.token0, flows.token1, poolAddr, showNet, ethPriceUSD, btcPriceUSD),
    [flows, poolAddr, showNet, ethPriceUSD, btcPriceUSD]
  )

  const hasFlows = leftNodes.length > 0 || rightNodes.length > 0
  if (!hasFlows) {
    return <div className="muted" style={{ fontSize: 10, padding: '4px 12px' }}>No token flow data for this pool.</div>
  }

  // Dynamic height: enough for the tallest column
  const colH = (nodes: SankeyNode[]) => nodes.length * (MIN_NODE_H + NODE_GAP) + PAD_Y * 2 + 40
  const H = Math.max(colH(leftNodes), colH(rightNodes), colH([poolNode]), 120)

  // Layout columns
  const lLeft  = layoutColumn(leftNodes,  COL_L, H - PAD_Y * 2, keyToHsl, addrLabel)
  const lPool  = layoutColumn([poolNode], COL_M, H - PAD_Y * 2,
    () => 'var(--accent)',
    () => `${t0sym}/${t1sym}`
  )
  const lRight = layoutColumn(rightNodes, COL_R, H - PAD_Y * 2, keyToHsl, addrLabel)

  const lEdges = allocateEdges(leftEdges,  lLeft, lPool,  COL_L + NODE_W, COL_M)
  const rEdges = allocateEdges(rightEdges, lPool, lRight, COL_M + NODE_W, COL_R)

  const openBasescan = (addr: string) => window.open(`https://basescan.org/address/${addr}`, '_blank', 'noopener')
  const toggleSelect = (id: string) => setSelectedId((prev) => prev === id ? null : id)

  const edgeDim    = selectedId !== null
  const edgeActive = (e: LEdge) => !edgeDim || e.edge.fromId === selectedId || e.edge.toId === selectedId

  const renderEdge = (e: LEdge, key: string, fromLabel: string, toLabel: string) => {
    const hasMatched  = !showNet && e.matchedFraction > 0.02
    const netFrac     = 1 - e.matchedFraction
    const active      = edgeActive(e)
    const sNetY1      = e.sy0 + (e.sy1 - e.sy0) * netFrac
    const tNetY1      = e.ty0 + (e.ty1 - e.ty0) * netFrac
    const baseOpacity = hasMatched ? 0.10 : 0.28
    return (
      <g key={key}>
        <path
          d={bandPath(e.sx, e.sy0, e.sy1, e.tx, e.ty0, e.ty1)}
          fill={e.color} opacity={active ? baseOpacity : baseOpacity * 0.15}
        >
          <title>
            {fromLabel} → {toLabel}{'\n'}{e.band.title}
            {hasMatched ? `\n(${Math.round(e.matchedFraction * 100)}% roundtrip)` : ''}
          </title>
        </path>
        {hasMatched && netFrac > 0.005 && (
          <path
            d={bandPath(e.sx, e.sy0, sNetY1, e.tx, e.ty0, tNetY1)}
            fill={e.color} opacity={active ? 0.28 : 0.04} pointerEvents="none"
          />
        )}
      </g>
    )
  }

  const renderAddrNode = (n: typeof lLeft[0], side: 'left' | 'right') => {
    const sel  = selectedId === n.id
    const dim  = edgeDim && !sel
    const lx   = side === 'left' ? n.x - 5 : n.x + NODE_W + 5
    const anch = side === 'left' ? 'end' : 'start'
    return (
      <g key={`n-${n.id}`} opacity={dim ? 0.3 : 1}>
        <rect
          x={n.x} y={n.y} width={NODE_W} height={n.h} rx={2}
          fill={n.color} stroke={sel ? 'var(--text)' : 'none'} strokeWidth={1.5}
          style={{ cursor: 'pointer' }}
          onClick={(ev) => { ev.stopPropagation(); toggleSelect(n.id) }}
        >
          <title>{n.id}</title>
        </rect>
        <text x={lx} y={n.y + n.h / 2 + 4} fontSize={8.5} fill="var(--text2)"
          textAnchor={anch} fontFamily="monospace"
          style={{ cursor: 'pointer', textDecoration: 'underline' }}
          onClick={(ev) => { ev.stopPropagation(); openBasescan(n.id) }}
        >{n.label}</text>
        <text x={lx} y={n.y + n.h / 2 + 14} fontSize={7.5} fill="var(--text3)"
          textAnchor={anch}>{fmtUSD(n.totalUSD)}</text>
      </g>
    )
  }

  const poolLNode = lPool[0]
  const selPool   = selectedId === poolNode.id
  const dimPool   = edgeDim && !selPool

  return (
    <div style={{ padding: '4px 8px 8px' }}>
      {/* Token totals line */}
      <div style={{ display: 'flex', gap: 10, fontSize: 9, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: poolTokenColor(flows.token0), fontWeight: 600 }}>{t0sym}</span>
        {flows.token0TotalIn  > 0n && <span style={{ color: 'var(--text3)' }}>in: <span style={{ color: poolTokenColor(flows.token0) }}>{fmtAmt(flows.token0, flows.token0TotalIn)}</span></span>}
        {flows.token0TotalOut > 0n && <span style={{ color: 'var(--text3)' }}>out: <span style={{ color: poolTokenColor(flows.token0) }}>{fmtAmt(flows.token0, flows.token0TotalOut)}</span></span>}
        <span style={{ color: 'var(--border)' }}>·</span>
        <span style={{ color: poolTokenColor(flows.token1), fontWeight: 600 }}>{t1sym}</span>
        {flows.token1TotalIn  > 0n && <span style={{ color: 'var(--text3)' }}>in: <span style={{ color: poolTokenColor(flows.token1) }}>{fmtAmt(flows.token1, flows.token1TotalIn)}</span></span>}
        {flows.token1TotalOut > 0n && <span style={{ color: 'var(--text3)' }}>out: <span style={{ color: poolTokenColor(flows.token1) }}>{fmtAmt(flows.token1, flows.token1TotalOut)}</span></span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
          <button className={`topbar-btn ${!showNet ? 'active' : ''}`} style={{ fontSize: 8, padding: '1px 5px' }}
            onClick={() => setShowNet(false)}>total</button>
          <button className={`topbar-btn ${showNet ? 'active' : ''}`} style={{ fontSize: 8, padding: '1px 5px' }}
            onClick={() => setShowNet(true)}>net</button>
        </div>
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`}
        style={{ overflow: 'visible', display: 'block' }}
        onClick={() => setSelectedId(null)}
      >
        {/* Column headers */}
        <text x={COL_L + NODE_W / 2} y={12} fontSize={8} fill="var(--text3)" textAnchor="middle">inflows →</text>
        <text x={COL_R + NODE_W / 2} y={12} fontSize={8} fill="var(--text3)" textAnchor="middle">← outflows</text>

        {/* Edges */}
        {lEdges.map((e, i) => renderEdge(e, `le${i}`, addrLabel(e.edge.fromId), `${t0sym}/${t1sym}`))}
        {rEdges.map((e, i) => renderEdge(e, `re${i}`, `${t0sym}/${t1sym}`, addrLabel(e.edge.toId)))}

        {/* Pool node */}
        {poolLNode && (
          <g opacity={dimPool ? 0.3 : 1}>
            <rect
              x={poolLNode.x} y={poolLNode.y} width={NODE_W} height={poolLNode.h} rx={2}
              fill="var(--accent)"
              stroke={selPool ? 'var(--text)' : 'none'} strokeWidth={1.5}
              style={{ cursor: 'pointer' }}
              onClick={(ev) => { ev.stopPropagation(); toggleSelect(poolNode.id) }}
            >
              <title>{poolAddr}</title>
            </rect>
            <text
              x={poolLNode.x + NODE_W / 2} y={poolLNode.y - 3}
              fontSize={8.5} fill="var(--text)" textAnchor="middle" fontWeight="bold"
              style={{ cursor: 'pointer', textDecoration: 'underline' }}
              onClick={(ev) => { ev.stopPropagation(); openBasescan(poolAddr) }}
            >{t0sym}/{t1sym}</text>
            <text x={poolLNode.x + NODE_W / 2} y={poolLNode.y + poolLNode.h + 11}
              fontSize={7.5} fill="var(--text3)" textAnchor="middle"
            >{shortAddr(poolAddr, 3)}</text>
          </g>
        )}

        {/* Address nodes */}
        {lLeft.map((n)  => renderAddrNode(n, 'left'))}
        {lRight.map((n) => renderAddrNode(n, 'right'))}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 10, fontSize: 8, color: 'var(--text3)', padding: '2px 4px', flexWrap: 'wrap' }}>
        {flows.token0 === USDC  && <span><span style={{ color: TOKEN_COLORS.usdc }}>■</span> USDC</span>}
        {flows.token0 === WETH  && <span><span style={{ color: TOKEN_COLORS.weth }}>■</span> WETH</span>}
        {flows.token0 === CBBTC && <span><span style={{ color: TOKEN_COLORS.cbtc }}>■</span> cbBTC</span>}
        {flows.token1 === USDC  && <span><span style={{ color: TOKEN_COLORS.usdc }}>■</span> USDC</span>}
        {flows.token1 === WETH  && <span><span style={{ color: TOKEN_COLORS.weth }}>■</span> WETH</span>}
        {flows.token1 === CBBTC && <span><span style={{ color: TOKEN_COLORS.cbtc }}>■</span> cbBTC</span>}
        {!showNet && <span style={{ opacity: 0.5 }}>■<span style={{ opacity: 0.3 }}>■</span> dim = roundtrip</span>}
      </div>
    </div>
  )
}
