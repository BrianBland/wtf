import { useMemo, useState, useRef } from 'react'
import { useStore } from '../store'
import { Block } from '../types'
import { buildHistograms, AggMetric } from '../lib/aggregations'
import { Histogram, SortKey } from './Histogram'
import { ProtocolDrillDown } from './ProtocolDrillDown'
import { MetaSankeyView } from './MetaSankeyView'
import { formatGas, formatGwei, formatNumber, formatTimestamp, gasColor } from '../lib/formatters'
import { KNOWN_PROTOCOLS } from '../lib/protocols'

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
 * Optional `chunkIndex` shifts lightness so stacked chunks are visually separated.
 */
function sparkBarColor(
  gasRatio:   number,
  blockNumber: number,
  target:     number,
  elasticity: number,
  chunkIndex?: number,
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
  const litAdj = chunkIndex !== undefined ? (chunkIndex % 2) * 8 : 0
  return `hsl(${hue.toFixed(0)},${sat}%,${(baseLit + litAdj)}%)`
}

function Sparkline({ blocks, onSelect, metric }: { blocks: Block[]; onSelect: (n: number) => void; metric: AggMetric }) {
  const liveFlashblocks = useStore((s) => s.liveFlashblocks)
  const chainElasticity = useStore((s) => s.chainElasticity)
  const target = 1 / chainElasticity

  const getValue = (b: Block) => metric === 'gas' ? Number(b.gasUsed) : b.transactions.length

  const liveVal = liveFlashblocks
    ? (metric === 'gas' ? Number(liveFlashblocks.totalGasUsed) : liveFlashblocks.totalTxCount)
    : 0
  const maxVal = Math.max(...blocks.map(getValue), liveVal, 1)

  const [hovered, setHovered] = useState<{ block: Block; x: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={containerRef}
      className="sparkline"
      style={{ position: 'relative' }}
      onMouseLeave={() => setHovered(null)}
    >
      {blocks.map((block) => {
        const v        = getValue(block)
        const h        = Math.max(2, Math.round((v / maxVal) * 32))
        const gasRatio = Number(block.gasUsed) / Number(block.gasLimit || 1)
        return (
          <div
            key={block.number}
            className="spark-bar"
            style={{ height: h, background: sparkBarColor(gasRatio, block.number, target, chainElasticity) }}
            onClick={() => onSelect(block.number)}
            onMouseEnter={(e) => {
              const rect = containerRef.current?.getBoundingClientRect()
              if (rect) setHovered({ block, x: e.clientX - rect.left })
            }}
          />
        )
      })}

      {/* Live block being built via flashblock stream */}
      {liveFlashblocks && (() => {
        const lv = liveVal
        const h  = Math.max(2, Math.round((lv / maxVal) * 32))
        const gasLimit = Number(liveFlashblocks.gasLimit || 1n)
        const chunks   = liveFlashblocks.chunks

        // Per-chunk segments: height proportional to each chunk's contribution
        let cumGas = 0n
        const segments = chunks.map((chunk, i) => {
          cumGas += chunk.gasUsed
          const cumRatio = Number(cumGas) / gasLimit
          const frac = metric === 'gas'
            ? Number(chunk.gasUsed) / Math.max(Number(liveFlashblocks.totalGasUsed), 1)
            : chunk.txCount / Math.max(liveFlashblocks.totalTxCount, 1)
          return { frac, color: sparkBarColor(cumRatio, liveFlashblocks.blockNumber, target, chainElasticity, i) }
        })

        return (
          <div
            key="live"
            className="spark-bar"
            style={{
              height: h,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              overflow: 'hidden',
              opacity: 0.85,
              outline: '1px solid var(--accent)',
              outlineOffset: -1,
            }}
            title={`#${liveFlashblocks.blockNumber} building… (${chunks.length} flashblocks, ${Math.round(Number(liveFlashblocks.totalGasUsed) / 1e6)}M gas)`}
          >
            {segments.map(({ frac, color }, i) => (
              <div
                key={i}
                style={{
                  flex: `0 0 ${(frac * 100).toFixed(1)}%`,
                  background: color,
                  borderTop: i > 0 ? '1px solid rgba(0,0,0,0.15)' : undefined,
                }}
              />
            ))}
          </div>
        )
      })()}

      {hovered && (() => {
        const b = hovered.block
        const gasRatio = Number(b.gasUsed) / Number(b.gasLimit)
        return (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
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
              #{b.number.toLocaleString()}
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

function BlockListPanel({ blocks, onSelect }: { blocks: Block[]; onSelect: (n: number) => void }) {
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
      <div className="panel-header">
        Blocks
        <span className="count">{blocks.length} loaded</span>
      </div>
      <div className="scroll-y" style={{ flex: 1 }}>
        {[...blocks].reverse().map((block) => {
          const gasRatio = Number(block.gasUsed) / Number(block.gasLimit)
          return (
            <div key={block.number} className="data-row" onClick={() => onSelect(block.number)}>
              <span style={{ color: 'var(--accent)', fontWeight: 600, minWidth: 78, fontVariantNumeric: 'tabular-nums' }}>
                #{block.number.toLocaleString()}
              </span>
              <span style={{ color: 'var(--text2)', fontSize: 10, minWidth: 52 }}>
                {formatTimestamp(block.timestamp)}
              </span>
              <span style={{ minWidth: 36, fontVariantNumeric: 'tabular-nums' }}>
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

// ── Main view ─────────────────────────────────────────────────────────────

export function BlockRangeView() {
  const blocksMap = useStore((s) => s.blocks)
  const goto      = useStore((s) => s.goto)
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

  const handleBlockSelect = (n: number) => goto({ view: 'block', blockNumber: n })

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
        <div className="panel" style={{ flex: 1, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>
              {sparkMetric === 'gas' ? 'Gas / block' : 'Tx / block'} — click to inspect
            </span>
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
          <Sparkline blocks={blocks} onSelect={handleBlockSelect} metric={sparkMetric} />
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
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 1fr 1fr', gap: 8, flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <BlockListPanel blocks={blocks} onSelect={handleBlockSelect} />

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
                    <Histogram entries={protocols} type="other" maxRows={8} sortBy={sortBy} />
                  </>
                )}
              </>
            ) : (
              <ProtocolDrillDown blocks={blocks} onSelectTx={(hash) => {
                // Find which block contains this tx and navigate to it
                for (const b of blocks) {
                  if (b.transactions.some((tx) => tx.hash === hash)) {
                    goto({ view: 'block', blockNumber: b.number })
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
