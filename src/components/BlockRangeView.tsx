import { useMemo, useState, useRef } from 'react'
import { useStore } from '../store'
import { Block } from '../types'
import { buildHistograms, AggMetric } from '../lib/aggregations'
import { Histogram, SortKey } from './Histogram'
import { ProtocolDrillDown } from './ProtocolDrillDown'
import { MetaSankeyView } from './MetaSankeyView'
import { formatGas, formatGwei, formatNumber, formatTimestamp, gasColor } from '../lib/formatters'
import { KNOWN_PROTOCOLS } from '../lib/protocols'
import { keyToHsl } from '../lib/colorize'

// ── Sparkline ─────────────────────────────────────────────────────────────

function Sparkline({ blocks, onSelect, metric }: { blocks: Block[]; onSelect: (n: number) => void; metric: AggMetric }) {
  const getValue = (b: Block) => metric === 'gas' ? Number(b.gasUsed) : b.transactions.length
  const maxVal   = Math.max(...blocks.map(getValue), 1)
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
        const v = getValue(block)
        const h = Math.max(2, Math.round((v / maxVal) * 32))
        return (
          <div
            key={block.number}
            className="spark-bar"
            style={{ height: h, background: keyToHsl(block.hash) }}
            onClick={() => onSelect(block.number)}
            onMouseEnter={(e) => {
              const rect = containerRef.current?.getBoundingClientRect()
              if (rect) setHovered({ block, x: e.clientX - rect.left })
            }}
          />
        )
      })}

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
  const { getSortedBlocks, goto } = useStore()
  const [sparkMetric, setSparkMetric] = useState<AggMetric>('txs')
  const [sortBy, setSortBy] = useState<SortKey>('txs')
  const [col4, setCol4] = useState<'methods' | 'activity'>('methods')
  const [showSankey,    setShowSankey]    = useState(false)
  const [sankeyExpanded, setSankeyExpanded] = useState(false)
  const blocks = getSortedBlocks()
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
