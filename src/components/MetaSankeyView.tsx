import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { Block } from '../types'
import { useStore } from '../store'
import { buildPoolActivity } from '../lib/poolActivity'
import { buildMetaFlow, MetaEdge, USDC, WETH, CBBTC } from '../lib/metaFlow'
import { KNOWN_TOKENS, KNOWN_PROTOCOLS } from '../lib/protocols'
import { formatAmount, formatEth, shortAddr } from '../lib/formatters'
import { keyToHsl } from '../lib/colorize'
import {
  NODE_W, NODE_GAP, MIN_NODE_H, PAD_Y, TOKEN_COLORS,
  fmtUSD, addrLabel, bandPath, layoutColumn, allocateEdges,
  SankeyEdge, SankeyBand, SankeyNode, LEdge,
} from '../lib/sankeyLayout'

// ── Layout constants ──────────────────────────────────────────────────────────

const W       = 880
const LABEL_W = 130

const COL_L = LABEL_W
const COL_M = W / 2 - NODE_W / 2
const COL_R = W - LABEL_W - NODE_W

const PROTOCOL_COLORS: Record<string, string> = {
  // DEX — V3-style CL
  'Uniswap V3':      '#ff007a',
  'Aerodrome CL':    '#00c4e0',
  'PancakeSwap V3':  '#1fc7d4',
  'SushiSwap V3':    '#fa52a0',
  'BaseSwap V3':     '#4a90e2',
  // DEX — V2-style AMM
  'Uniswap V2':      '#ff6da0',
  'Aerodrome':       '#0091b5',
  'PancakeSwap V2':  '#18a8b3',
  'SushiSwap V2':    '#e0478d',
  'BaseSwap V2':     '#3a78c9',
  // DEX — other
  'Balancer V2':     '#aea8f5',
  // Lending
  'Aave V3':         '#b6509e',
  'Seamless':        '#5f4def',
  'Morpho Blue':     '#2470ff',
  'Euler':           '#e040fb',
  'Compound V3':     '#00d395',
  'Moonwell':        '#7cfc00',
}

// ── Other-token USD conversion ────────────────────────────────────────────────

// Tokens whose price tracks ETH (liquid staking / restaking derivatives)
const ETH_PRICED_TOKENS = new Set([
  '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22',  // cbETH
  '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452',  // wstETH
  '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a',  // weETH
  '0xab36452dbac151be02b16ca17d8919826072f64a',  // rETH
])

/**
 * Derive implied USD prices for unknown tokens by observing their swap ratios
 * against USDC/WETH/cbBTC within pool flows across all blocks.
 *
 * For each transaction, computes net flows per pool per token. If a known-priced
 * token flows one way and another token flows the other way, it's a swap and the
 * ratio gives the implied price. Accumulates weighted across all swaps observed.
 *
 * Returns: Map of token address → µUSD per raw token unit.
 */
function deriveImpliedPrices(
  blocks: Block[],
  poolAddrs: Set<string>,
  ethPriceUSD: number,
  btcPriceUSD: number,
): Map<string, number> {
  // µUSD per 1 raw unit for the three anchor tokens
  const anchorPrice = (addr: string): number => {
    if (addr === USDC)  return 1                          // 6 dec: 1 µUSD/raw
    if (addr === WETH)  return ethPriceUSD * 1e6 / 1e18  // per wei
    if (addr === CBBTC) return btcPriceUSD * 1e6 / 1e8   // per sat
    return 0
  }

  // For each token address: accumulate (sumKnownMicroUSD, sumUnknownRaw)
  const acc = new Map<string, { usd: number; raw: number }>()

  for (const block of blocks) {
    for (const tx of block.transactions) {
      // Net flow per pool per token: positive = into pool, negative = out of pool
      const poolNet = new Map<string, Map<string, bigint>>()
      for (const flow of tx.tokenFlows) {
        if (poolAddrs.has(flow.to)) {
          if (!poolNet.has(flow.to)) poolNet.set(flow.to, new Map())
          const m = poolNet.get(flow.to)!
          m.set(flow.token, (m.get(flow.token) ?? 0n) + flow.amount)
        }
        if (poolAddrs.has(flow.from)) {
          if (!poolNet.has(flow.from)) poolNet.set(flow.from, new Map())
          const m = poolNet.get(flow.from)!
          m.set(flow.token, (m.get(flow.token) ?? 0n) - flow.amount)
        }
      }

      for (const flows of poolNet.values()) {
        const anchors:  Array<{ net: bigint; price: number }> = []
        const unknowns: Array<{ addr: string; net: bigint }> = []

        for (const [addr, net] of flows) {
          const p = anchorPrice(addr)
          if (p > 0) anchors.push({ net, price: p })
          else       unknowns.push({ addr, net })
        }

        for (const anc of anchors) {
          for (const unk of unknowns) {
            // Opposite sign = one token in, one out = swap
            if ((anc.net > 0n) === (unk.net > 0n)) continue
            const ancAmt = anc.net > 0n ? anc.net : -anc.net
            const unkAmt = unk.net > 0n ? unk.net : -unk.net
            if (unkAmt === 0n) continue
            const e = acc.get(unk.addr) ?? { usd: 0, raw: 0 }
            e.usd += Number(ancAmt) * anc.price
            e.raw += Number(unkAmt)
            acc.set(unk.addr, e)
          }
        }
      }
    }
  }

  const result = new Map<string, number>()
  for (const [addr, { usd, raw }] of acc) {
    if (raw > 0) result.set(addr, usd / raw)
  }
  return result
}

/**
 * Convert a raw "other" token amount to µUSD.
 * Priority: implied price from observed swaps → ETH-priced KNOWN_TOKENS → $1 KNOWN_TOKENS → 0.
 */
function otherRawToMicroUSD(
  addr: string,
  rawAmt: bigint,
  ethPriceUSD: number,
  impliedPrices: Map<string, number>,
): bigint {
  // 1. Implied price from observed swap ratios (live, works for any token)
  const implied = impliedPrices.get(addr)
  if (implied !== undefined && implied > 0) {
    return BigInt(Math.round(Number(rawAmt) * implied))
  }
  // 2. KNOWN_TOKENS fallback (gate prevents $1/token overestimates for unknowns)
  const info = KNOWN_TOKENS[addr]
  if (!info) return 0n
  const dec = info.decimals
  const microBase = dec >= 6
    ? (dec === 6 ? rawAmt : rawAmt / (10n ** BigInt(dec - 6)))
    : rawAmt * (10n ** BigInt(6 - dec))
  if (ETH_PRICED_TOKENS.has(addr)) {
    return microBase * BigInt(Math.round(ethPriceUSD))
  }
  return microBase  // $1/token assumption for stable KNOWN_TOKENS
}

// ── MetaEdge → SankeyEdge conversion ─────────────────────────────────────────

function metaToSankeyEdge(
  e: MetaEdge,
  ethPriceUSD: number,
  btcPriceUSD: number,
  tokenSym: (addr: string) => string,
  impliedPrices: Map<string, number>,
): SankeyEdge {
  const ethN = BigInt(Math.round(ethPriceUSD))
  const btcN = BigInt(Math.round(btcPriceUSD))
  const wethUSD     = e.wethAmt    * ethN / 1_000_000_000_000n
  const cbtcUSD     = e.cbBTCAmt   * btcN / 100n
  const matchedWETH = e.matchedWeth * ethN / 1_000_000_000_000n
  const matchedCBTC = e.matchedCbtc * btcN / 100n

  const bands: SankeyBand[] = [
    { color: TOKEN_COLORS.usdc, usd: e.usdcAmt,  matchedUSD: e.matchedUsdc, title: `USDC ${formatAmount(e.usdcAmt, 6, 2)}` },
    { color: TOKEN_COLORS.weth, usd: wethUSD,     matchedUSD: matchedWETH,   title: `WETH ${formatEth(e.wethAmt, 4)}` },
    { color: TOKEN_COLORS.cbtc, usd: cbtcUSD,     matchedUSD: matchedCBTC,   title: `cbBTC ${formatAmount(e.cbBTCAmt, 8, 6)}` },
  ].filter((b) => b.usd > 0n)

  for (const [addr, rawAmt] of e.otherTokens) {
    if (rawAmt === 0n) continue
    const usd = otherRawToMicroUSD(addr, rawAmt, ethPriceUSD, impliedPrices)
    if (usd === 0n) continue
    const info = KNOWN_TOKENS[addr]
    const title = info
      ? `${info.symbol} ${formatAmount(rawAmt, info.decimals, 4)}`
      : `${tokenSym(addr)} ~${fmtUSD(usd)}`
    bands.push({ color: keyToHsl(addr), usd, matchedUSD: 0n, title })
  }

  const liveTotalUSD = bands.reduce((s, b) => s + b.usd, 0n)
  return { fromId: e.fromId, toId: e.toId, totalUSD: liveTotalUSD, bands }
}

// ── Main component ─────────────────────────────────────────────────────────

export function MetaSankeyView({ blocks, targetHeight }: { blocks: Block[]; targetHeight?: number }) {
  const { poolCache, fetchPool, ethPriceUSD, btcPriceUSD, tokenCache, fetchToken } = useStore()
  const [showNet, setShowNet]           = useState(false)
  const [selectedId, setSelectedId]     = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const svgWrapRef   = useRef<HTMLDivElement>(null)
  const dragStart    = useRef<{ x: number; y: number } | null>(null)
  const [xform, setXform] = useState({ scale: 1, x: 0, y: 0 })

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const toggleFullscreen = () => {
    if (isFullscreen) document.exitFullscreen()
    else containerRef.current?.requestFullscreen()
  }

  // ── Zoom / pan ────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = svgWrapRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect   = el.getBoundingClientRect()
      const cx     = e.clientX - rect.left
      const cy     = e.clientY - rect.top
      setXform(prev => {
        const factor   = e.deltaY < 0 ? 1.15 : 1 / 1.15
        const newScale = Math.min(8, Math.max(0.2, prev.scale * factor))
        const ratio    = newScale / prev.scale
        return { scale: newScale, x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio }
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragStart.current = { x: e.clientX, y: e.clientY }
  }, [])
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStart.current) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    dragStart.current = { x: e.clientX, y: e.clientY }
    setXform(p => ({ ...p, x: p.x + dx, y: p.y + dy }))
  }, [])
  const onMouseUp   = useCallback(() => { dragStart.current = null }, [])
  const resetZoom   = useCallback(() => setXform({ scale: 1, x: 0, y: 0 }), [])
  const isZoomed    = xform.scale !== 1 || xform.x !== 0 || xform.y !== 0

  const poolAddrs = useMemo(() => {
    const activity = buildPoolActivity(blocks)
    for (const addr of activity.keys()) fetchPool(addr)
    return new Set(activity.keys())
  }, [blocks, fetchPool])

  // Trigger token fetches for pool token0/token1 once pool metadata loads
  useEffect(() => {
    for (const addr of poolAddrs) {
      const meta = poolCache.get(addr)
      if (typeof meta !== 'object') continue
      if (meta.token0 && !KNOWN_TOKENS[meta.token0] && !tokenCache.has(meta.token0)) fetchToken(meta.token0)
      if (meta.token1 && !KNOWN_TOKENS[meta.token1] && !tokenCache.has(meta.token1)) fetchToken(meta.token1)
    }
  }, [poolAddrs, poolCache, tokenCache, fetchToken])

  const graph = useMemo(
    () => buildMetaFlow(blocks, poolAddrs, { netMode: showNet }),
    [blocks, poolAddrs, showNet]
  )

  const impliedPrices = useMemo(
    () => deriveImpliedPrices(blocks, poolAddrs, ethPriceUSD, btcPriceUSD),
    [blocks, poolAddrs, ethPriceUSD, btcPriceUSD]
  )

  const getPoolColor = (id: string) => {
    const meta = poolCache.get(id)
    if (typeof meta === 'object') return PROTOCOL_COLORS[meta.protocol] ?? 'var(--accent)'
    return 'var(--text3)'
  }

  const tokenSym = (addr: string) => {
    const known = KNOWN_TOKENS[addr]
    if (known) return known.symbol
    const cached = tokenCache.get(addr)
    if (cached && typeof cached === 'object' && 'symbol' in cached) return (cached as { symbol: string }).symbol
    return shortAddr(addr, 3)
  }

  const getPoolLabel = (id: string) => {
    const meta = poolCache.get(id)
    if (typeof meta === 'object' && meta.token0 && meta.token1) {
      return `${tokenSym(meta.token0)}/${tokenSym(meta.token1)}`
    }
    const known = KNOWN_PROTOCOLS[id]
    if (known) return known.name
    return shortAddr(id, 3)
  }

  const { senders, pools, recipients, senderToPool, poolToRecip } = graph

  if (pools.length === 0) {
    return (
      <div className="muted" style={{ padding: '16px', fontSize: 11 }}>
        No USDC / WETH / cbBTC pool flows detected in this block range.
      </div>
    )
  }

  // Convert edges to live-priced SankeyEdges (totalUSD = band sum at live prices)
  const spSankeyEdges = senderToPool.map(e => metaToSankeyEdge(e, ethPriceUSD, btcPriceUSD, tokenSym, impliedPrices))
  const prSankeyEdges = poolToRecip.map(e => metaToSankeyEdge(e, ethPriceUSD, btcPriceUSD, tokenSym, impliedPrices))

  // Recompute node totals from live-priced edges so heights/labels use live prices
  const liveSenderTotals = new Map<string, bigint>()
  const livePoolTotals   = new Map<string, bigint>()
  const liveRecipTotals  = new Map<string, bigint>()
  for (const e of spSankeyEdges) {
    liveSenderTotals.set(e.fromId, (liveSenderTotals.get(e.fromId) ?? 0n) + e.totalUSD)
    livePoolTotals.set(e.toId,   (livePoolTotals.get(e.toId)   ?? 0n) + e.totalUSD)
  }
  for (const e of prSankeyEdges) {
    livePoolTotals.set(e.fromId, (livePoolTotals.get(e.fromId) ?? 0n) + e.totalUSD)
    liveRecipTotals.set(e.toId, (liveRecipTotals.get(e.toId)  ?? 0n) + e.totalUSD)
  }
  const liveSenders    = senders.map(n    => ({ ...n, totalUSD: liveSenderTotals.get(n.id) ?? 0n }))
  // Only include pools that have at least one visible edge (avoids orphaned zero-flow nodes)
  const livePools      = pools.filter(n => livePoolTotals.has(n.id))
                              .map(n   => ({ ...n, totalUSD: livePoolTotals.get(n.id)! }))
  const liveRecipients = recipients.map(n => ({ ...n, totalUSD: liveRecipTotals.get(n.id)  ?? 0n }))

  const colH = (nodes: SankeyNode[]) =>
    nodes.length * (MIN_NODE_H + NODE_GAP) + PAD_Y * 2 + 60
  const naturalH = Math.max(colH(liveSenders), colH(livePools), colH(liveRecipients), 200)
  // targetHeight overrides natural size; when MetaSankeyView's own fullscreen button is used
  // (no parent targetHeight), fill the screen.
  const H = targetHeight !== undefined
    ? Math.max(naturalH, targetHeight)
    : isFullscreen
      ? Math.max(naturalH, window.innerHeight - 80)
      : naturalH

  const lSenders    = layoutColumn(liveSenders,    COL_L, H - PAD_Y * 2, keyToHsl, addrLabel)
  const lPools      = layoutColumn(livePools,      COL_M, H - PAD_Y * 2, getPoolColor, getPoolLabel)
  const lRecipients = layoutColumn(liveRecipients, COL_R, H - PAD_Y * 2, keyToHsl, addrLabel)

  const spEdges = allocateEdges(spSankeyEdges, lSenders, lPools,      COL_L + NODE_W, COL_M)
  const prEdges = allocateEdges(prSankeyEdges, lPools,   lRecipients, COL_M + NODE_W, COL_R)

  const openBasescan = (addr: string) => window.open(`https://basescan.org/address/${addr}`, '_blank', 'noopener')
  const toggleSelect = (id: string) => setSelectedId((prev) => prev === id ? null : id)

  const edgeDim    = selectedId !== null
  const edgeActive = (e: LEdge) => !edgeDim || e.edge.fromId === selectedId || e.edge.toId === selectedId

  const renderEdge = (e: LEdge, i: number, isSP: boolean) => {
    const fromLabel = isSP ? addrLabel(e.edge.fromId)   : getPoolLabel(e.edge.fromId)
    const toLabel   = isSP ? getPoolLabel(e.edge.toId)  : addrLabel(e.edge.toId)
    const hasMatched = !showNet && e.matchedFraction > 0.02
    const netFrac    = 1 - e.matchedFraction
    const active     = edgeActive(e)
    const sNetY1     = e.sy0 + (e.sy1 - e.sy0) * netFrac
    const tNetY1     = e.ty0 + (e.ty1 - e.ty0) * netFrac
    const baseOpacity = hasMatched ? 0.10 : 0.28

    return (
      <g key={`e${i}`}>
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

  const renderNode = (n: typeof lSenders[0], side: 'left' | 'mid' | 'right') => {
    const sel = selectedId === n.id
    const dim = edgeDim && !sel
    const labelX = side === 'left'  ? n.x - 5
                 : side === 'right' ? n.x + NODE_W + 5
                 : n.x + NODE_W / 2
    const labelAnchor = side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle'
    const labelY  = side === 'mid' ? n.y - 3 : n.y + n.h / 2 + 4
    const valueY  = side === 'mid' ? n.y + n.h + 11 : n.y + n.h / 2 + 14
    return (
      <g key={`n-${n.id}`} opacity={dim ? 0.3 : 1}>
        <rect
          x={n.x} y={n.y} width={NODE_W} height={n.h} rx={2}
          fill={n.color}
          stroke={sel ? 'var(--text)' : 'none'} strokeWidth={1.5}
          style={{ cursor: 'pointer' }}
          onClick={(ev) => { ev.stopPropagation(); toggleSelect(n.id) }}
        >
          <title>{n.id}</title>
        </rect>
        <text
          x={labelX} y={labelY} fontSize={8.5}
          fill={side === 'mid' ? 'var(--text)' : 'var(--text2)'}
          textAnchor={labelAnchor}
          fontFamily={side === 'mid' ? undefined : 'monospace'}
          fontWeight={side === 'mid' ? 'bold' : undefined}
          style={{ cursor: 'pointer', textDecoration: 'underline' }}
          onClick={(ev) => { ev.stopPropagation(); openBasescan(n.id) }}
        >{n.label}</text>
        <text x={labelX} y={valueY} fontSize={7.5} fill="var(--text3)"
          textAnchor={labelAnchor}>{fmtUSD(n.totalUSD)}</text>
      </g>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{
        padding: '8px 0',
        ...(isFullscreen ? { background: 'var(--surface)', display: 'flex', flexDirection: 'column' } : {}),
      }}
    >
      {/* Scrollable / zoomable SVG area */}
      <div
        ref={svgWrapRef}
        style={{
          overflow: 'hidden', position: 'relative', cursor: 'grab',
          minHeight: 0,
          ...(isFullscreen ? { flex: 1 } : { height: H }),
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <div style={{ transform: `translate(${xform.x}px,${xform.y}px) scale(${xform.scale})`, transformOrigin: '0 0' }}>
          <svg
            width={W} height={H}
            style={{ display: 'block', overflow: 'visible' }}
            onClick={() => setSelectedId(null)}
          >
            {/* Column headers */}
            <text x={COL_L + NODE_W / 2} y={12} fontSize={9} fill="var(--text3)" textAnchor="middle" fontWeight="bold">Senders</text>
            <text x={COL_M + NODE_W / 2} y={12} fontSize={9} fill="var(--text3)" textAnchor="middle" fontWeight="bold">Pools</text>
            <text x={COL_R + NODE_W / 2} y={12} fontSize={9} fill="var(--text3)" textAnchor="middle" fontWeight="bold">Recipients</text>

            {/* Edges */}
            {spEdges.map((e, i) => renderEdge(e, i,                  true))}
            {prEdges.map((e, i) => renderEdge(e, spEdges.length + i, false))}

            {/* Nodes */}
            {lSenders.map((n)    => renderNode(n, 'left'))}
            {lPools.map((n)      => renderNode(n, 'mid'))}
            {lRecipients.map((n) => renderNode(n, 'right'))}
          </svg>
        </div>
      </div>

      {/* Legend + controls */}
      <div style={{ display: 'flex', gap: 12, fontSize: 9, color: 'var(--text3)', padding: '4px 16px', alignItems: 'center', flexShrink: 0 }}>
        <span><span style={{ color: '#4caf7d' }}>■</span> USDC</span>
        <span><span style={{ color: '#7eb8f7' }}>■</span> WETH</span>
        <span><span style={{ color: '#f7931a' }}>■</span> cbBTC</span>
        <span><span style={{ color: 'var(--accent)' }}>■</span> other (≈$1/token)</span>
        {!showNet && <span style={{ opacity: 0.5 }}>■<span style={{ opacity: 0.3 }}>■</span> dim = roundtrip</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <span>ETH {ethPriceUSD >= 1000 ? `$${(ethPriceUSD / 1000).toFixed(1)}k` : `$${ethPriceUSD.toFixed(0)}`}, BTC {btcPriceUSD >= 1000 ? `$${(btcPriceUSD / 1000).toFixed(0)}k` : `$${btcPriceUSD.toFixed(0)}`}</span>
          <span style={{ color: 'var(--border)', margin: '0 4px' }}>·</span>
          {isZoomed && (
            <button className="topbar-btn" style={{ fontSize: 9, padding: '1px 6px' }} onClick={resetZoom}>reset zoom</button>
          )}
          <button className={`topbar-btn ${!showNet ? 'active' : ''}`} style={{ fontSize: 9, padding: '1px 7px' }}
            onClick={() => setShowNet(false)}>total</button>
          <button className={`topbar-btn ${showNet ? 'active' : ''}`} style={{ fontSize: 9, padding: '1px 7px' }}
            onClick={() => setShowNet(true)}>net</button>
          <span style={{ color: 'var(--border)', margin: '0 4px' }}>·</span>
          <button className="topbar-btn" style={{ fontSize: 11, padding: '0px 6px', lineHeight: 1 }}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={toggleFullscreen}>{isFullscreen ? '✕' : '⛶'}</button>
        </div>
      </div>
    </div>
  )
}
