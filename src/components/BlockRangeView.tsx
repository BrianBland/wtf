import { useEffect, useMemo, useState, useRef } from 'react'
import { useStore } from '../store'
import { Block } from '../types'
import { buildHistograms, AggMetric } from '../lib/aggregations'
import { carryBlockFilters } from '../lib/urlState'
import { Histogram, HistEntry, SortKey } from './Histogram'
import { ProtocolDrillDown } from './ProtocolDrillDown'
import { MetaSankeyView } from './MetaSankeyView'
import { formatGas, formatGwei, formatNumber, formatTimestamp, gasColor } from '../lib/formatters'
import { KNOWN_PROTOCOLS, PROTOCOL_CLASSIFICATION } from '../lib/protocols'
import { blockUtilization } from '../lib/baseChain'
import { SHELF_ROW_BLOCKS, shelfRows } from '../lib/blockShelf'

// ── Sparkline ─────────────────────────────────────────────────────────────

/**
 * Color a sparkline bar by gas utilization.
 *
 *  [0, target]:          purple (280°) → green (130°)   below target, baseFee falling
 *  [target, target×2]:   green (130°) → yellow (60°)    over target, baseFee rising
 *  [target×2, 1]:        yellow (60°) → red (0°)        heavy load (only when elasticity ≥ 2)
 *
 * `target` = 1/elasticity (e.g. 1/6 ≈ 0.167 for Base/OP Stack)
 * Small sat/lightness variance by block number keeps adjacent bars distinct.
 */
function sparkBarColor(
  gasRatio:   number,
  blockNumber: number,
  target:     number,
  elasticity: number,
): string {
  let hue: number
  const t0 = Math.max(target, 0.001)
  if (gasRatio <= target) {
    // purple (280°) → green (130°)
    hue = 280 - (gasRatio / t0) * 150
  } else if (elasticity >= 2 && gasRatio < target * 2) {
    // green (130°) → yellow (60°)
    hue = 130 - ((gasRatio - target) / t0) * 70
  } else {
    // yellow (60°) → red (0°)
    const lo = elasticity >= 2 ? target * 2 : target
    const t  = Math.min(1, (gasRatio - lo) / Math.max(0.001, 1 - lo))
    hue = 60 * (1 - t)
  }
  const cycle  = blockNumber % 4
  const sat    = 68 + (cycle & 1) * 14        // 68% or 82%
  const baseLit = 46 + (cycle >> 1) * 10      // 46% or 56%
  return `hsl(${hue.toFixed(0)},${sat}%,${baseLit}%)`
}

const COLLAPSED_ROWS = 2

function Sparkline({ blocks, onSelect, metric, expanded }: {
  blocks: Block[]; onSelect: (n: number) => void; metric: AggMetric; expanded: boolean
}) {
  const chainElasticity = useStore((s) => s.chainElasticity)
  const target = 1 / chainElasticity

  const getValue = (b: Block) => metric === 'gas' ? Number(b.gasUsed) : b.transactions.length
  const maxVal = Math.max(...blocks.map(getValue), 1)

  const rows = useMemo(() => shelfRows(blocks), [blocks])
  const visibleRows = expanded ? rows : rows.slice(0, COLLAPSED_ROWS)
  const rowHeight = expanded ? 18 : 28

  const [hovered, setHovered] = useState<{ block: Block; x: number; y: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 3 }}
      onMouseLeave={() => setHovered(null)}
    >
      {visibleRows.map(([row, rowBlocks]) => {
        const first = row * SHELF_ROW_BLOCKS
        const firstLoaded = rowBlocks.values().next().value as Block
        return (
          <div key={row} style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            <span style={{ fontSize: 9, color: 'var(--text3)', width: 52, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {formatTimestamp(firstLoaded.timestampMs).slice(0, 8)}
            </span>
            <div className="sparkline shelf-row" style={{ height: rowHeight, flex: 1 }}>
              {Array.from({ length: SHELF_ROW_BLOCKS }, (_, i) => {
                const block = rowBlocks.get(first + i)
                if (!block) return <span key={i} className="spark-slot" />
                const h = Math.max(2, Math.round((getValue(block) / maxVal) * rowHeight))
                return (
                  <button
                    key={i}
                    type="button"
                    className="spark-bar"
                    aria-label={`Block ${block.number}`}
                    style={{ height: h, background: sparkBarColor(blockUtilization(block), block.number, target, chainElasticity) }}
                    onClick={() => onSelect(block.number)}
                    onMouseEnter={(e) => {
                      const rect = containerRef.current?.getBoundingClientRect()
                      const bar = e.currentTarget.parentElement!.getBoundingClientRect()
                      if (rect) setHovered({ block, x: e.clientX - rect.left, y: bar.bottom - rect.top })
                    }}
                  />
                )
              })}
            </div>
          </div>
        )
      })}

      {hovered && (() => {
        const b = hovered.block
        const gasRatio = blockUtilization(b)
        return (
          <div style={{
            position: 'absolute',
            top: hovered.y + 4,
            left: Math.min(hovered.x, (containerRef.current?.clientWidth ?? 9999) - 140),
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 10,
            color: 'var(--text)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
            lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 600, color: 'var(--accent)' }}>
              #{b.number.toLocaleString()} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>{formatTimestamp(b.timestampMs)}</span>
            </div>
            <div style={{ color: 'var(--text2)' }}>
              {b.transactions.length} txs · {formatGas(b.gasUsed)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ flex: 1, height: 3, background: 'var(--surface3)', borderRadius: 1, overflow: 'hidden' }}>
                <div style={{
                  width: `${gasRatio * 100}%`, height: '100%',
                  background: gasColor(gasRatio),
                }} />
              </div>
              <span style={{ color: 'var(--text3)', fontSize: 9 }}>{(gasRatio * 100).toFixed(0)}%</span>
            </div>
            {b.baseFeePerGas > 0n && (
              <div style={{ color: 'var(--text3)', fontSize: 9 }}>
                base {formatGwei(b.baseFeePerGas)}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}


// ── Block list ────────────────────────────────────────────────────────────

const BLOCK_LIST_ROWS = 200

function BlockListPanel({ blocks, onSelect }: { blocks: Block[]; onSelect: (n: number) => void }) {
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
      <div className="panel-header">
        Blocks
        <span className="count">{blocks.length} loaded</span>
      </div>
      <div className="scroll-y" style={{ flex: 1 }}>
        {blocks.slice(-BLOCK_LIST_ROWS).reverse().map((block) => {
          const gasRatio = blockUtilization(block)
          return (
            <div key={block.number} className="data-row" onClick={() => onSelect(block.number)}>
              <span style={{ color: 'var(--accent)', fontWeight: 600, minWidth: 78, fontVariantNumeric: 'tabular-nums' }}>
                #{block.number.toLocaleString()}
              </span>
              <span style={{ color: 'var(--text2)', fontSize: 10, minWidth: 64, fontVariantNumeric: 'tabular-nums' }}>
                {formatTimestamp(block.timestampMs)}
              </span>
              <span style={{ minWidth: 40, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {block.transactions.length}
                <span className="muted" style={{ fontSize: 9 }}> tx</span>
              </span>
              {/* Gas gauge */}
              <div style={{ flex: 1, height: 4, background: 'var(--surface3)', borderRadius: 1, overflow: 'hidden', minWidth: 40 }}>
                <div style={{
                  width: `${gasRatio * 100}%`, height: '100%',
                  background: gasColor(gasRatio),
                }} />
              </div>
              {block.baseFeePerGas > 0n && (
                <span className="muted" style={{ fontSize: 10, minWidth: 60, textAlign: 'right' }}>
                  {formatGwei(block.baseFeePerGas)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Stats bar ─────────────────────────────────────────────────────────────

function SummaryStats({ blocks }: { blocks: Block[] }) {
  const totalTx = blocks.reduce((s, b) => s + b.transactions.length, 0)
  const avgTx   = blocks.length ? Math.round(totalTx / blocks.length) : 0
  const avgGas  = blocks.length ? blocks.reduce((s, b) => s + Number(b.gasUsed), 0) / blocks.length : 0
  const avgBase = blocks.length && blocks[0]?.baseFeePerGas
    ? blocks.reduce((s, b) => s + Number(b.baseFeePerGas), 0) / blocks.length : 0

  return (
    <div className="range-stats">
      <div className="stat"><span className="stat-label">Blocks</span><span className="stat-value">{formatNumber(blocks.length)}</span></div>
      <div className="stat"><span className="stat-label">Total Tx</span><span className="stat-value">{formatNumber(totalTx)}</span></div>
      <div className="stat"><span className="stat-label">Avg Tx/Block</span><span className="stat-value">{avgTx}</span></div>
      <div className="stat"><span className="stat-label">Avg Gas</span><span className="stat-value">{formatGas(BigInt(Math.round(avgGas)))}</span></div>
      {avgBase > 0 && <div className="stat"><span className="stat-label">Avg Base Fee</span><span className="stat-value">{formatGwei(BigInt(Math.round(avgBase)))}</span></div>}
    </div>
  )
}

// ── Classified protocol histogram ─────────────────────────────────────────

const PROTO_CLASS_ORDER = ['Concentrated Liquidity', 'Classic AMM', 'Lending', 'Bridge', 'Perps DEX', 'Aggregator', 'Other']

function ClassifiedProtocolHistogram({ entries, sortBy }: { entries: HistEntry[]; sortBy: SortKey }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (cls: string) =>
    setCollapsed((prev) => { const s = new Set(prev); s.has(cls) ? s.delete(cls) : s.add(cls); return s })

  // Group entries by classification
  const groups = new Map<string, HistEntry[]>()
  for (const entry of entries) {
    const cls = PROTOCOL_CLASSIFICATION[entry.key] ?? 'Other'
    if (!groups.has(cls)) groups.set(cls, [])
    groups.get(cls)!.push(entry)
  }

  return (
    <>
      {PROTO_CLASS_ORDER.filter((c) => groups.has(c)).map((cls) => {
        const open = !collapsed.has(cls)
        return (
          <div key={cls}>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '2px 12px', background: 'var(--surface3)',
                cursor: 'pointer', userSelect: 'none',
              }}
              onClick={() => toggle(cls)}
            >
              <span style={{ fontSize: 9, color: 'var(--text3)' }}>{open ? '▼' : '▶'}</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {cls}
              </span>
            </div>
            {open && (
              <Histogram entries={groups.get(cls)!} type="other" maxRows={20} sortBy={sortBy} />
            )}
          </div>
        )
      })}
    </>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────

/** Trailing throttle: 5 blocks/s would otherwise re-run every aggregation 5 times a second. */
function useThrottledValue<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value)
  const lastShownAt = useRef(0)
  useEffect(() => {
    const wait = Math.max(0, lastShownAt.current + ms - Date.now())
    const timer = setTimeout(() => { lastShownAt.current = Date.now(); setShown(value) }, wait)
    return () => clearTimeout(timer)
  }, [value, ms])
  return shown
}

export function BlockRangeView() {
  const liveBlocks  = useStore((s) => s.blocks)
  const latestBlock = useStore((s) => s.latestBlock)
  const throttledBlocks = useThrottledValue(liveBlocks, 1000)
  // Freeze the feed while the pointer is over it so a block stays put long enough to click.
  const [pausedBlocks, setPausedBlocks] = useState<Map<number, Block> | null>(null)
  const blocksMap = pausedBlocks ?? throttledBlocks
  const pauseFeed  = () => setPausedBlocks((paused) => paused ?? throttledBlocks)
  const resumeFeed = () => setPausedBlocks(null)
  const [shelfExpanded, setShelfExpanded] = useState(false)
  const goto      = useStore((s) => s.goto)
  const nav       = useStore((s) => s.nav)
  const [sparkMetric, setSparkMetric] = useState<AggMetric>('txs')
  const [sortBy, setSortBy] = useState<SortKey>('txs')
  const [col4, setCol4] = useState<'methods' | 'activity'>('methods')
  const [showSankey,    setShowSankey]    = useState(false)
  const [sankeyExpanded, setSankeyExpanded] = useState(false)
  const blocks = useMemo(
    () => [...blocksMap.values()].sort((a, b) => a.number - b.number),
    [blocksMap]
  )
  const { senders, recipients, selectors, protocols } = useMemo(
    () => buildHistograms(blocks),
    [blocks]
  )

  const handleBlockSelect = (n: number) => goto(carryBlockFilters(nav, { view: 'block', blockNumber: n }))
  const newWhilePaused = pausedBlocks && latestBlock !== null && blocks.length > 0
    ? Math.max(0, latestBlock - blocks[blocks.length - 1].number)
    : 0
  const shelfSeconds = blocks.length > 1
    ? Math.round((blocks[blocks.length - 1].timestampMs - blocks[0].timestampMs) / 1000)
    : 0

  if (blocks.length === 0) {
    return (
      <div className="empty-state">
        Waiting for blocks…<br />
        <div className="shimmer" style={{ width: 200, margin: '12px auto' }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8, padding: 8, overflow: 'hidden' }}>
      {/* Top bar: stats + sparkline */}
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <div className="panel" style={{ padding: '8px 12px' }}>
          <SummaryStats blocks={blocks} />
        </div>
        <div
          className="panel"
          style={{ flex: 1, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}
          onMouseEnter={pauseFeed}
          onMouseLeave={resumeFeed}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>
              {sparkMetric === 'gas' ? 'Gas / block' : 'Tx / block'} — 30s per row, click to inspect
            </span>
            {pausedBlocks && (
              <span style={{ fontSize: 9, color: 'var(--amber)' }}>
                ⏸ paused{newWhilePaused > 0 ? ` · ${newWhilePaused} new` : ''}
              </span>
            )}
            <button
              className={`topbar-btn ${shelfExpanded ? 'active' : ''}`}
              style={{ fontSize: 9, padding: '1px 7px' }}
              title={shelfExpanded ? 'Show the last minute' : 'Show every loaded block'}
              onClick={() => setShelfExpanded((e) => !e)}
            >{shelfExpanded ? `all ${Math.floor(shelfSeconds / 60)}m${shelfSeconds % 60}s ▲` : 'more ▼'}</button>
            <button
              className={`topbar-btn ${sparkMetric === 'txs' ? 'active' : ''}`}
              style={{ fontSize: 9, padding: '1px 7px' }}
              onClick={() => setSparkMetric('txs')}
            >txs</button>
            <button
              className={`topbar-btn ${sparkMetric === 'gas' ? 'active' : ''}`}
              style={{ fontSize: 9, padding: '1px 7px' }}
              onClick={() => setSparkMetric('gas')}
            >gas</button>
          </div>
          <Sparkline blocks={blocks} onSelect={handleBlockSelect} metric={sparkMetric} expanded={shelfExpanded} />
        </div>
      </div>

      {/* Full-width Sankey panel — toggleable */}
      <div className="panel" style={{ flexShrink: 0 }}>
        <div
          className="panel-header"
          style={{ userSelect: 'none' }}
        >
          <span
            style={{ fontSize: 10, color: 'var(--text3)', marginRight: 4, cursor: 'pointer' }}
            onClick={() => setShowSankey((s) => !s)}
          >{showSankey ? '▼' : '▶'}</span>
          <span style={{ cursor: 'pointer' }} onClick={() => setShowSankey((s) => !s)}>
            Value Flow Sankey
          </span>
          <span className="count">USDC &amp; WETH · senders → pools → recipients</span>
          {showSankey && (
            <button
              className={`topbar-btn ${sankeyExpanded ? 'active' : ''}`}
              style={{ marginLeft: 'auto', fontSize: 10, padding: '0px 6px', lineHeight: 1.4 }}
              title={sankeyExpanded ? 'Collapse height' : 'Expand height'}
              onClick={() => setSankeyExpanded((e) => !e)}
            >⇕</button>
          )}
        </div>
        {showSankey && (
          <div style={{ maxHeight: sankeyExpanded ? '65vh' : '38vh', overflow: 'auto' }}>
            <MetaSankeyView
              blocks={blocks}
              targetHeight={sankeyExpanded ? Math.round(window.innerHeight * 0.6) : undefined}
            />
          </div>
        )}
      </div>

      {/* Main: block list + 3 histograms */}
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 1fr 1fr', gap: 8, flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <div onMouseEnter={pauseFeed} onMouseLeave={resumeFeed} style={{ minHeight: 0, height: '100%' }}>
          <BlockListPanel blocks={blocks} onSelect={handleBlockSelect} />
        </div>

        {/* Senders */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="panel-header">
            Senders<span className="count">{senders.length} unique</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 3, alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--text3)', marginRight: 2 }}>sort:</span>
              <button className={`topbar-btn ${sortBy === 'txs' ? 'active' : ''}`}
                style={{ fontSize: 9, padding: '1px 7px' }} onClick={() => setSortBy('txs')}>txs</button>
              <button className={`topbar-btn ${sortBy === 'gas' ? 'active' : ''}`}
                style={{ fontSize: 9, padding: '1px 7px' }} title="Gas used (via eth_getBlockReceipts)"
                onClick={() => setSortBy('gas')}>gas</button>
            </div>
          </div>
          <div className="scroll-y" style={{ flex: 1 }}>
            <Histogram entries={senders} type="address" maxRows={14} sortBy={sortBy} />
          </div>
        </div>

        {/* Recipients */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="panel-header">Recipients<span className="count">{recipients.length} unique</span></div>
          <div className="scroll-y" style={{ flex: 1 }}>
            <Histogram entries={recipients} type="address" maxRows={14} sortBy={sortBy} />
          </div>
        </div>

        {/* Methods | Protocol Activity (tabbed) */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="panel-header" style={{ gap: 0 }}>
            <button
              className={`topbar-btn ${col4 === 'methods' ? 'active' : ''}`}
              style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3 }}
              onClick={() => setCol4('methods')}
            >Methods</button>
            <button
              className={`topbar-btn ${col4 === 'activity' ? 'active' : ''}`}
              style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, marginLeft: 2 }}
              onClick={() => setCol4('activity')}
            >Activity</button>
            {col4 === 'methods' && (
              <span className="count">{selectors.length} unique</span>
            )}
          </div>
          <div className="scroll-y" style={{ flex: 1 }}>
            {col4 === 'methods' ? (
              <>
                <Histogram entries={selectors} type="selector" maxRows={10} sortBy={sortBy} />
                {protocols.length > 0 && (
                  <>
                    <div className="panel-header" style={{ borderTop:'1px solid var(--border)', marginTop:4, fontSize:10 }}>
                      Protocols
                    </div>
                    <ClassifiedProtocolHistogram entries={protocols} sortBy={sortBy} />
                  </>
                )}
              </>
            ) : (
              <ProtocolDrillDown blocks={blocks} onSelectTx={(hash) => {
                // Find which block contains this tx and navigate to it
                for (const b of blocks) {
                  if (b.transactions.some((tx) => tx.hash === hash)) {
                    goto(carryBlockFilters(nav, { view: 'block', blockNumber: b.number }))
                    return
                  }
                }
              }} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
