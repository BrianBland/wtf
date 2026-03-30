import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { useStore } from '../store'
import { Block, Transaction, TokenFlow } from '../types'
import { BlockStateAccessView } from './BlockStateAccessView'
import { buildHistograms } from '../lib/aggregations'
import { SortKey } from './Histogram'
import { Histogram } from './Histogram'
import { HexTag, SelectorTag } from './HexTag'
import { CollapsibleList } from './CollapsibleList'
import { ProtocolEventList, TokenFlowList, EthFlowList } from './ValueFlow'
import { AccountActivity } from './AccountActivity'
import { ProtocolDrillDown } from './ProtocolDrillDown'
import { MetaSankeyView } from './MetaSankeyView'
import { CallAggregationsView } from './CallAggregationsView'
import { DecodedCallView } from './TxView'
import { KNOWN_TOKENS, KNOWN_PROTOCOLS, KNOWN_SELECTORS } from '../lib/protocols'
import { formatEth, formatGas, formatGwei, formatTimestamp, formatAge, formatNumber, shortHash } from '../lib/formatters'
import { flashblockCount, effectivePriorityFee } from '../lib/flashblocks'
import { computeParallelization, aggregateKeys } from '../lib/stateAccess'

// ── DeFi action glyphs ────────────────────────────────────────────────────

const ACTION_GLYPH: Record<string, string> = {
  'Swap':             '⇄',
  'Supply':           '↑',
  'Withdraw':         '↓',
  'Borrow':           '⤓',
  'Repay':            '⤒',
  'AddLiquidity':     '+',
  'RemoveLiquidity':  '−',
  'Liquidation':      '⚡',
  'Flash Loan':       '↯',
  'Transfer':         '→',
  'Wrap':             '⊕',
  'Unwrap':           '⊖',
}

function defiSummary(protocols: { action: string }[]): string {
  const counts = new Map<string, number>()
  for (const p of protocols) counts.set(p.action, (counts.get(p.action) ?? 0) + 1)
  return [...counts.entries()]
    .map(([action, n]) => {
      const g = ACTION_GLYPH[action] ?? action[0]
      return n > 1 ? `${g}×${n}` : g
    })
    .join(' ')
}

// ── Explorer links ────────────────────────────────────────────────────────

function ExplorerLink({ hash, type = 'tx', visible = false }: { hash: string; type?: 'tx' | 'address'; visible?: boolean }) {
  const url = type === 'tx'
    ? `https://basescan.org/tx/${hash}`
    : `https://basescan.org/address/${hash}`
  return (
    <a
      className={`explorer-link${visible ? ' explorer-link-visible' : ''}`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open in Basescan`}
      onClick={(e) => e.stopPropagation()}
    >↗</a>
  )
}

// ── Block nav & header ────────────────────────────────────────────────────

function BlockHeader({ blockNumber }: { blockNumber: number }) {
  const { blocks, goto, latestBlock } = useStore()
  const block = blocks.get(blockNumber)

  const goPrev = () => goto({ view: 'block', blockNumber: blockNumber - 1 })
  const goNext = () => goto({ view: 'block', blockNumber: blockNumber + 1 })

  return (
    <div style={{ flexShrink: 0 }}>
      {/* Navigation row */}
      <div className="nav-controls">
        <button className="nav-btn" disabled={!blocks.has(blockNumber - 1)} onClick={goPrev}>← prev</button>
        <div className="nav-label">
          Block <strong style={{ color: 'var(--accent)' }}>#{blockNumber.toLocaleString()}</strong>
        </div>
        <button
          className="nav-btn"
          disabled={!blocks.has(blockNumber + 1) && !(latestBlock !== null && blockNumber < latestBlock)}
          onClick={goNext}
        >next →</button>
        <button className="nav-btn" style={{ marginLeft: 8 }} onClick={() => goto({ view: 'range' })}>↑ range</button>
      </div>

      {/* Stats grid */}
      {block && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderBottom: '1px solid var(--border)' }}>
          {[
            { label: 'Time',     value: `${formatTimestamp(block.timestamp)} · ${formatAge(block.timestamp)}` },
            { label: 'Txs',      value: formatNumber(block.transactions.length) },
            { label: 'Gas Used', value: formatGas(block.gasUsed) },
            { label: 'Gas Limit',value: formatGas(block.gasLimit) },
            { label: 'Base Fee', value: block.baseFeePerGas > 0n ? formatGwei(block.baseFeePerGas) : '—' },
          ].map(({ label, value }) => (
            <div key={label} style={{ padding: '5px 12px', borderRight: '1px solid var(--border)' }}>
              <div className="stat-label">{label}</div>
              <div className="stat-value" style={{ fontSize: 11 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Hash + miner row */}
      {block && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 12px', borderBottom: '1px solid var(--border)', fontSize: 10, color: 'var(--text3)' }}>
          <span>Hash:</span><HexTag value={block.hash} type="hash" muted />
          <span className="inline-sep">·</span>
          <span>Miner:</span><HexTag value={block.miner} type="address" />
          {KNOWN_PROTOCOLS[block.miner] && <span className="badge muted">{KNOWN_PROTOCOLS[block.miner].name}</span>}
        </div>
      )}
    </div>
  )
}

// ── Inline histograms panel ───────────────────────────────────────────────

interface HistogramFilter {
  sender:    string | null
  recipient: string | null
  selector:  string | null
}

function BlockHistograms({
  blockNumber, filter, onFilter, sortBy, onSortBy,
}: {
  blockNumber: number
  filter: HistogramFilter
  onFilter: (f: HistogramFilter) => void
  sortBy: SortKey
  onSortBy: (s: SortKey) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [expanded,  setExpanded]  = useState(false)
  const { blocks } = useStore()
  const block = blocks.get(blockNumber)

  const { senders, recipients, selectors } = useMemo(
    () => buildHistograms(block ? [block] : []),
    [block]
  )

  const toggle = (field: keyof HistogramFilter, key: string) => {
    onFilter({ ...filter, [field]: filter[field] === key ? null : key })
  }

  return (
    <div style={{ flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
      <div className="panel-header" style={{ userSelect: 'none' }}>
        <span
          style={{ fontSize: 10, color: 'var(--text3)', marginRight: 4, cursor: 'pointer' }}
          onClick={() => setCollapsed((c) => !c)}
        >{collapsed ? '▶' : '▼'}</span>
        <span style={{ cursor: 'pointer' }} onClick={() => setCollapsed((c) => !c)}>
          Aggregations for this block
        </span>
        <span className="count">
          {senders.length} senders · {recipients.length} recipients · {selectors.length} methods
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 3, alignItems: 'center' }}>
          {!collapsed && (
            <button
              className={`topbar-btn ${expanded ? 'active' : ''}`}
              style={{ fontSize: 10, padding: '0px 6px', lineHeight: 1.4 }}
              title={expanded ? 'Collapse height' : 'Expand height'}
              onClick={() => setExpanded((e) => !e)}
            >⇕</button>
          )}
          <span style={{ fontSize: 9, color: 'var(--text3)', marginLeft: 2, marginRight: 2 }}>sort:</span>
          <button className={`topbar-btn ${sortBy === 'txs' ? 'active' : ''}`}
            style={{ fontSize: 9, padding: '1px 7px' }} onClick={() => onSortBy('txs')}>txs</button>
          <button className={`topbar-btn ${sortBy === 'gas' ? 'active' : ''}`}
            style={{ fontSize: 9, padding: '1px 7px' }} title="Gas limit (not gasUsed — proxy only)"
            onClick={() => onSortBy('gas')}>gas lim</button>
        </div>
      </div>

      {!collapsed && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', maxHeight: expanded ? '65vh' : 180, overflow: 'hidden' }}>
          <div style={{ borderRight: '1px solid var(--border)', overflow: 'hidden' }}>
            <div className="panel-header" style={{ fontSize: 10, padding: '3px 12px' }}>Senders</div>
            <div style={{ overflowY: 'auto', maxHeight: expanded ? 'calc(65vh - 30px)' : 150 }}>
              <Histogram entries={senders} type="address" maxRows={expanded ? 50 : 6}
                onSelect={(k) => toggle('sender', k)} selectedKey={filter.sender} sortBy={sortBy} />
            </div>
          </div>
          <div style={{ borderRight: '1px solid var(--border)', overflow: 'hidden' }}>
            <div className="panel-header" style={{ fontSize: 10, padding: '3px 12px' }}>Recipients</div>
            <div style={{ overflowY: 'auto', maxHeight: expanded ? 'calc(65vh - 30px)' : 150 }}>
              <Histogram entries={recipients} type="address" maxRows={expanded ? 50 : 6}
                onSelect={(k) => toggle('recipient', k)} selectedKey={filter.recipient} sortBy={sortBy} />
            </div>
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div className="panel-header" style={{ fontSize: 10, padding: '3px 12px' }}>Methods</div>
            <div style={{ overflowY: 'auto', maxHeight: expanded ? 'calc(65vh - 30px)' : 150 }}>
              <Histogram entries={selectors} type="selector" maxRows={expanded ? 50 : 6}
                onSelect={(k) => toggle('selector', k)} selectedKey={filter.selector} sortBy={sortBy} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Transaction row ───────────────────────────────────────────────────────

type TxFilter = 'all' | 'eth' | 'tokens' | 'defi'

function TokenFlowBadges({ tokenFlows }: { tokenFlows: TokenFlow[] }) {
  const { tokenCache } = useStore()
  const tokens = [...new Set(tokenFlows.map((f) => f.token))]
  const shown  = tokens.slice(0, 3)
  const extra  = tokens.length - shown.length

  return (
    <>
      {shown.map((addr) => {
        const s = KNOWN_PROTOCOLS[addr] ? null : (
          tokenCache.get(addr) && typeof tokenCache.get(addr) === 'object'
            ? (tokenCache.get(addr) as { symbol: string }).symbol
            : null
        )
        const staticSym = (KNOWN_TOKENS as Record<string, { symbol: string }>)[addr]?.symbol
        const sym = staticSym ?? s ?? addr.slice(2, 6).toUpperCase()
        return (
          <span key={addr} className="badge cyan" title={addr}>{sym}</span>
        )
      })}
      {extra > 0 && <span className="badge muted" style={{ fontSize: 9 }}>+{extra}</span>}
    </>
  )
}

function TxRow({ tx, baseFee, selected, onClick }: { tx: Transaction; baseFee: bigint; selected: boolean; onClick: () => void }) {
  const hasEth    = tx.value > 0n
  const hasTokens = tx.tokenFlows.length > 0
  const hasDefi   = tx.protocols.length > 0
  const gasUsed   = tx.gasUsed ?? tx.gas
  const tip       = effectivePriorityFee(tx, baseFee)

  return (
    <div className={`data-row ${selected ? 'selected' : ''}`} onClick={onClick}>
      {/* Index */}
      <span style={{ color: 'var(--text3)', minWidth: 30, fontSize: 10, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {tx.index}
      </span>

      {/* Hash */}
      <span style={{ color: 'var(--text2)', fontSize: 10, minWidth: 90, flexShrink: 0 }}>{shortHash(tx.hash)}</span>

      {/* From → To · method */}
      <div className="flex-center gap4" style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
        <HexTag value={tx.from} type="address" />
        <ExplorerLink hash={tx.from} type="address" />
        <span className="flow-arrow" style={{ flexShrink: 0 }}>→</span>
        {tx.to
          ? <><HexTag value={tx.to} type="address" /><ExplorerLink hash={tx.to} type="address" /></>
          : <span className="badge muted">deploy</span>}
        <span className="muted" style={{ fontSize: 9, flexShrink: 0 }}>·</span>
        <SelectorTag selector={tx.methodSelector} />
      </div>

      {/* Gas + fee */}
      <div style={{ minWidth: 110, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}>
        <div style={{ fontSize: 10, color: 'var(--text2)' }}>{formatGas(gasUsed)}</div>
        <div style={{ fontSize: 9, color: tip > 0n ? 'var(--accent)' : 'var(--text3)' }}>+{formatGwei(tip)}</div>
      </div>

      {/* Flows summary */}
      <div className="flex-center gap4" style={{ minWidth: 140, justifyContent: 'flex-end', flexShrink: 0, flexWrap: 'wrap' }}>
        {hasEth    && <span className="badge amber">{formatEth(tx.value, 4)} ETH</span>}
        {hasTokens && <TokenFlowBadges tokenFlows={tx.tokenFlows} />}
        {hasDefi   && <span className="badge purple">{defiSummary(tx.protocols)}</span>}
        {!hasEth && !hasTokens && !hasDefi && <span className="muted" style={{ fontSize: 10 }}>—</span>}
      </div>

      {/* Tx explorer link — appears on row hover, far right */}
      <ExplorerLink hash={tx.hash} type="tx" />
    </div>
  )
}

// ── Tx quick-detail panel ─────────────────────────────────────────────────

function TxQuickDetail({ tx, blockNumber }: { tx: Transaction; blockNumber: number }) {
  const { goto } = useStore()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderLeft: '1px solid var(--border)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <HexTag value={tx.hash} type="hash" muted />
        <ExplorerLink hash={tx.hash} type="tx" visible />
        <button
          className="nav-btn"
          style={{ marginLeft: 'auto', color: 'var(--accent)', whiteSpace: 'nowrap' }}
          onClick={() => goto({ view: 'tx', txHash: tx.hash, blockNumber })}
        >Full trace →</button>
      </div>

      <div className="scroll-y" style={{ flex: 1 }}>
        {/* From / To */}
        <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div className="flex-center gap4" style={{ fontSize: 11 }}>
            <span className="muted" style={{ minWidth: 28, fontSize: 10 }}>from</span>
            <HexTag value={tx.from} type="address" />
            <ExplorerLink hash={tx.from} type="address" visible />
          </div>
          {tx.to && (
            <div className="flex-center gap4" style={{ fontSize: 11 }}>
              <span className="muted" style={{ minWidth: 28, fontSize: 10 }}>to</span>
              <HexTag value={tx.to} type="address" />
              <ExplorerLink hash={tx.to} type="address" visible />
              {KNOWN_PROTOCOLS[tx.to] && <span className="badge muted">{KNOWN_PROTOCOLS[tx.to].name}</span>}
            </div>
          )}
          {tx.value > 0n && (
            <div className="flex-center gap4" style={{ fontSize: 11 }}>
              <span className="muted" style={{ minWidth: 28, fontSize: 10 }}>val</span>
              <span className="badge amber">{formatEth(tx.value, 6)} ETH</span>
            </div>
          )}
        </div>

        {/* Decoded call / raw input */}
        {tx.input && tx.input !== '0x' && tx.methodSelector && (
          <section>
            <div className="panel-header" style={{ fontSize: 10 }}>Call</div>
            <DecodedCallView input={tx.input} selector={tx.methodSelector} />
          </section>
        )}

        {/* Protocol events */}
        {tx.protocols.length > 0 && (
          <section>
            <div className="panel-header" style={{ fontSize: 10 }}>Protocol Activity</div>
            <ProtocolEventList events={tx.protocols} />
          </section>
        )}

        {/* ETH flows */}
        {tx.ethFlows.length > 0 && (
          <section>
            <div className="panel-header" style={{ fontSize: 10 }}>ETH Flows</div>
            <EthFlowList flows={tx.ethFlows} />
          </section>
        )}

        {/* Token flows */}
        {tx.tokenFlows.length > 0 && (
          <section>
            <div className="panel-header" style={{ fontSize: 10 }}>Token Flows ({tx.tokenFlows.length})</div>
            <TokenFlowList flows={tx.tokenFlows} />
          </section>
        )}

        {/* Logs compact */}
        {tx.logs.length > 0 && (
          <section>
            <div className="panel-header" style={{ fontSize: 10 }}>Logs ({tx.logs.length})</div>
            <CollapsibleList
              items={tx.logs}
              pageSize={3}
              label="logs"
              renderItem={(log, i) => (
                <div key={i} className="log-row">
                  <div className="flex-center gap4">
                    <HexTag value={log.address} type="address" />
                    {log.topics[0] && <span className="muted" style={{ fontSize: 9 }}>{log.topics[0].slice(0, 10)}…</span>}
                  </div>
                </div>
              )}
            />
          </section>
        )}

        {tx.protocols.length === 0 && tx.tokenFlows.length === 0 && tx.ethFlows.length === 0 && (
          <div className="empty-state" style={{ padding: 16 }}>No value flows detected</div>
        )}
      </div>
    </div>
  )
}

// ── Shared fullscreen hook ────────────────────────────────────────────────

function useFullscreen() {
  const ref = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])
  const toggle = () => {
    if (isFullscreen) document.exitFullscreen()
    else ref.current?.requestFullscreen()
  }
  return { ref, isFullscreen, toggle }
}

// ── State access panel ────────────────────────────────────────────────────

function CollapsibleStateAccess({ block, onSelectTx }: { block: Block; onSelectTx?: (hash: string | null) => void }) {
  const [open, setOpen]         = useState(false)
  const [expanded, setExpanded] = useState(false)
  const { blockStateCache } = useStore()
  const { ref, isFullscreen, toggle: toggleFullscreen } = useFullscreen()
  const cache = blockStateCache.get(block.number)
  const running = cache?.status === 'running'
  const keyBreakdown = useMemo(() => {
    if (cache?.status !== 'done') return null
    const all = aggregateKeys(cache.txResults, false)
    return {
      accRead:   all.filter(k => !k.slot && k.readCount  > 0).length,
      accWrite:  all.filter(k => !k.slot && k.writeCount > 0).length,
      slotRead:  all.filter(k =>  k.slot && k.readCount  > 0).length,
      slotWrite: all.filter(k =>  k.slot && k.writeCount > 0).length,
    }
  }, [cache])
  const subtitle = running
    ? `${cache.done}/${cache.total} traced…`
    : keyBreakdown
      ? `${cache!.txResults.size} txs · ${keyBreakdown.accRead}a/${keyBreakdown.slotRead}s read · ${keyBreakdown.accWrite}a/${keyBreakdown.slotWrite}s written`
      : 'click to trace'

  return (
    <div
      ref={ref}
      style={{
        flexShrink: 0, borderBottom: '1px solid var(--border)',
        ...(isFullscreen ? { background: 'var(--surface)', display: 'flex', flexDirection: 'column' } : {}),
      }}
    >
      <div
        className="panel-header"
        style={{ userSelect: 'none', cursor: 'pointer' }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ fontSize: 10, color: 'var(--text3)', marginRight: 4 }}>
          {open ? '▼' : '▶'}
        </span>
        State Access
        <span className="count">{subtitle}</span>
        {running && (
          <span style={{ marginLeft: 6, fontSize: 8, color: 'var(--accent)', animation: 'pulse 1s infinite' }}>
            ●
          </span>
        )}
        {open && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button
              className={`topbar-btn ${expanded ? 'active' : ''}`}
              style={{ fontSize: 10, padding: '0px 6px', lineHeight: 1.4 }}
              title={expanded ? 'Collapse height' : 'Expand height'}
              onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x) }}
            >⇕</button>
            <button
              className="topbar-btn"
              style={{ fontSize: 11, padding: '0px 6px', lineHeight: 1 }}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              onClick={(e) => { e.stopPropagation(); toggleFullscreen() }}
            >{isFullscreen ? '✕' : '⛶'}</button>
          </div>
        )}
      </div>
      {open && (
        <div style={{ overflow: 'auto', ...(isFullscreen ? { flex: 1 } : { maxHeight: expanded ? '65vh' : '55vh' }) }}>
          <BlockStateAccessView block={block} onSelectTx={onSelectTx} />
        </div>
      )}
    </div>
  )
}

// ── Protocol drill-down panel ─────────────────────────────────────────────

function CollapsibleProtocols({ block, onSelectTx }: { block: Block; onSelectTx: (hash: string) => void }) {
  const [collapsed, setCollapsed] = useState(true)
  const [expanded, setExpanded]   = useState(false)
  const { ref, isFullscreen, toggle: toggleFullscreen } = useFullscreen()
  const protocolCount = new Set(block.transactions.flatMap((tx) => tx.protocols.map((e) => e.protocol))).size
  if (protocolCount === 0) return null

  const contentHeight = isFullscreen ? undefined : (expanded ? '65vh' : 200)

  return (
    <div
      ref={ref}
      style={{
        flexShrink: 0, borderBottom: '1px solid var(--border)',
        ...(isFullscreen ? { background: 'var(--surface)', display: 'flex', flexDirection: 'column' } : {}),
      }}
    >
      <div className="panel-header" style={{ userSelect: 'none' }}>
        <span
          style={{ fontSize: 10, color: 'var(--text3)', marginRight: 4, cursor: 'pointer' }}
          onClick={() => setCollapsed((c) => !c)}
        >{collapsed ? '▶' : '▼'}</span>
        <span style={{ cursor: 'pointer' }} onClick={() => setCollapsed((c) => !c)}>
          Protocol Activity
        </span>
        <span className="count">{protocolCount} protocol{protocolCount !== 1 ? 's' : ''}</span>
        {!collapsed && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button
              className={`topbar-btn ${expanded ? 'active' : ''}`}
              style={{ fontSize: 10, padding: '0px 6px', lineHeight: 1.4 }}
              title={expanded ? 'Collapse height' : 'Expand height'}
              onClick={() => setExpanded((e) => !e)}
            >⇕</button>
            <button
              className="topbar-btn"
              style={{ fontSize: 11, padding: '0px 6px', lineHeight: 1 }}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              onClick={toggleFullscreen}
            >{isFullscreen ? '✕' : '⛶'}</button>
          </div>
        )}
      </div>
      {!collapsed && (
        <div style={{ overflowY: 'auto', ...(isFullscreen ? { flex: 1 } : { maxHeight: contentHeight }) }}>
          <ProtocolDrillDown blocks={[block]} onSelectTx={onSelectTx} />
        </div>
      )}
    </div>
  )
}

// ── Value flow Sankey panel ───────────────────────────────────────────────

function CollapsibleMetaSankey({ block }: { block: Block }) {
  const [open, setOpen]         = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [selectedFBs, setSelectedFBs] = useState(() => new Set<number>())
  const { ref, isFullscreen, toggle: toggleFullscreen } = useFullscreen()
  const resolveFlashblocks = useStore((s) => s.resolveFlashblocks)

  const fbMap   = useMemo(() => resolveFlashblocks(block.number, block.transactions, block.baseFeePerGas), [block.number, block.transactions, block.baseFeePerGas, resolveFlashblocks])
  const fbCount = flashblockCount(fbMap)

  const filteredBlock = useMemo(() => {
    if (selectedFBs.size === 0) return block
    return { ...block, transactions: block.transactions.filter(t => selectedFBs.has(fbMap.get(t.hash) ?? 0)) }
  }, [block, selectedFBs, fbMap])

  const blocks = useMemo(() => [filteredBlock], [filteredBlock])

  const toggleFB = useCallback((n: number) => {
    setSelectedFBs(prev => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n); else next.add(n)
      return next
    })
  }, [])

  return (
    <div
      ref={ref}
      style={{
        flexShrink: 0, borderBottom: '1px solid var(--border)',
        ...(isFullscreen ? { background: 'var(--surface)', display: 'flex', flexDirection: 'column' } : {}),
      }}
    >
      <div className="panel-header" style={{ userSelect: 'none' }}>
        <span
          style={{ fontSize: 10, color: 'var(--text3)', marginRight: 4, cursor: 'pointer' }}
          onClick={() => setOpen((o) => !o)}
        >{open ? '▼' : '▶'}</span>
        <span style={{ cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
          Value Flow
        </span>
        <span className="count">senders → pools → recipients</span>

        {/* Flashblock filter pills */}
        {open && fbCount > 1 && (
          <div style={{ display: 'flex', gap: 2, marginLeft: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 8, color: 'var(--text3)' }}>fb:</span>
            <button
              className={`topbar-btn ${selectedFBs.size === 0 ? 'active' : ''}`}
              style={{ fontSize: 8, padding: '0px 5px' }}
              onClick={(e) => { e.stopPropagation(); setSelectedFBs(new Set()) }}
            >all</button>
            {Array.from({ length: fbCount }, (_, i) => (
              <button
                key={i}
                className={`topbar-btn ${selectedFBs.has(i) ? 'active' : ''}`}
                style={{ fontSize: 8, padding: '0px 5px' }}
                title={`Flashblock ${i}${i === 0 ? ' (system tx)' : ''}`}
                onClick={(e) => { e.stopPropagation(); toggleFB(i) }}
              >{i}</button>
            ))}
          </div>
        )}

        {open && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button
              className={`topbar-btn ${expanded ? 'active' : ''}`}
              style={{ fontSize: 10, padding: '0px 6px', lineHeight: 1.4 }}
              title={expanded ? 'Collapse height' : 'Expand height'}
              onClick={() => setExpanded((e) => !e)}
            >⇕</button>
            <button
              className="topbar-btn"
              style={{ fontSize: 11, padding: '0px 6px', lineHeight: 1 }}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              onClick={toggleFullscreen}
            >{isFullscreen ? '✕' : '⛶'}</button>
          </div>
        )}
      </div>
      {open && (
        <div style={{ overflow: 'auto', ...(isFullscreen ? { flex: 1, minHeight: 0 } : { maxHeight: expanded ? '65vh' : 300 }) }}>
          <MetaSankeyView
            blocks={blocks}
            targetHeight={
              isFullscreen ? window.innerHeight - 120
              : expanded   ? Math.round(window.innerHeight * 0.6)
              : undefined
            }
          />
        </div>
      )}
    </div>
  )
}

// ── Call aggregations panel ───────────────────────────────────────────────

function CollapsibleCallAggregations({ block }: { block: Block }) {
  const [open, setOpen]         = useState(false)
  const [expanded, setExpanded] = useState(false)
  const { blockStateCache, startBlockStateTrace } = useStore()
  const { ref, isFullscreen, toggle: toggleFullscreen } = useFullscreen()
  const cache = blockStateCache.get(block.number)
  const callResults = cache?.callResults
  const running = cache?.status === 'running'

  // Trigger trace loading as soon as the panel is opened
  useEffect(() => {
    if (open && !cache) startBlockStateTrace(block.number)
  }, [open, block.number, cache])

  const subtitle = running
    ? `${cache.done}/${cache.total} traced…`
    : callResults?.size
      ? `${callResults.size} txs traced`
      : open && !cache ? 'loading…' : ''

  return (
    <div
      ref={ref}
      style={{
        flexShrink: 0, borderBottom: '1px solid var(--border)',
        ...(isFullscreen ? { background: 'var(--surface)', display: 'flex', flexDirection: 'column' } : {}),
      }}
    >
      <div
        className="panel-header"
        style={{ userSelect: 'none', cursor: 'pointer' }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ fontSize: 10, color: 'var(--text3)', marginRight: 4 }}>
          {open ? '▼' : '▶'}
        </span>
        Call Aggregations
        <span className="count">{subtitle}</span>
        {running && (
          <span style={{ marginLeft: 6, fontSize: 8, color: 'var(--accent)', animation: 'pulse 1s infinite' }}>
            ●
          </span>
        )}
        {open && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button
              className={`topbar-btn ${expanded ? 'active' : ''}`}
              style={{ fontSize: 10, padding: '0px 6px', lineHeight: 1.4 }}
              title={expanded ? 'Collapse height' : 'Expand height'}
              onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x) }}
            >⇕</button>
            <button
              className="topbar-btn"
              style={{ fontSize: 11, padding: '0px 6px', lineHeight: 1 }}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              onClick={(e) => { e.stopPropagation(); toggleFullscreen() }}
            >{isFullscreen ? '✕' : '⛶'}</button>
          </div>
        )}
      </div>
      {open && (
        <div style={{ overflow: 'auto', ...(isFullscreen ? { flex: 1 } : { maxHeight: expanded ? '65vh' : '40vh' }) }}>
          {callResults && callResults.size > 0
            ? <CallAggregationsView callResults={callResults} />
            : <div className="empty-state" style={{ padding: 16 }}>
                {running ? `Tracing… ${cache.done}/${cache.total}` : !cache ? 'Starting trace…' : 'No call data available'}
              </div>
          }
        </div>
      )}
    </div>
  )
}

const EMPTY_HIST_FILTER: HistogramFilter = { sender: null, recipient: null, selector: null }

// ── Trace stats bar ───────────────────────────────────────────────────────

function TraceStatsBar({ block }: { block: Block }) {
  const { blockStateCache, startBlockStateTrace } = useStore()
  const cache = blockStateCache.get(block.number)
  const running = cache?.status === 'running'
  const done    = cache?.status === 'done'

  const parallelStats = useMemo(() => {
    if (!done || !cache?.txResults) return null
    return computeParallelization(cache.txResults, block.transactions.map((t) => t.hash))
  }, [done, cache?.txResults, block.transactions])

  const readOnlyStats = useMemo(() => {
    if (!done || !cache?.txResults) return null
    const n = block.transactions.length
    if (n === 0) return null
    let count = 0
    let gasNum = 0n
    for (const tx of block.transactions) {
      const accesses = cache.txResults.get(tx.hash)
      if (!accesses) continue  // errored or untraced — unknown, don't count as read-only
      const sender   = tx.from?.toLowerCase()
      const hasSlotWrite    = accesses.some((a) => a.slot  && a.type === 'write')
      const hasBalanceWrite = accesses.some((a) => !a.slot && a.type === 'write' && a.addr !== sender)
      if (!hasSlotWrite && !hasBalanceWrite) {
        count++
        gasNum += tx.gasUsed ?? 0n
      }
    }
    const gasDen = block.gasUsed || 1n
    const gasPct = block.transactions.some((t) => t.gasUsed !== undefined)
      ? Math.round(Number(gasNum * 100n / gasDen))
      : null
    return { count, txPct: Math.round(count / n * 100), gasPct }
  }, [done, cache?.txResults, block.transactions, block.gasUsed])

  // Not yet triggered
  if (!cache) {
    return (
      <div style={{ flexShrink: 0, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px' }}>
        <span className="muted" style={{ fontSize: 10 }}>Trace stats</span>
        <span style={{ color: 'var(--border)' }}>·</span>
        <button
          className="topbar-btn"
          style={{ fontSize: 10 }}
          onClick={() => startBlockStateTrace(block.number)}
        >
          load →
        </button>
      </div>
    )
  }

  // Loading in progress
  if (running) {
    const pct = cache.total > 0 ? Math.round(cache.done / cache.total * 100) : 0
    return (
      <div style={{ flexShrink: 0, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px' }}>
        <span className="muted" style={{ fontSize: 10 }}>Trace stats</span>
        <span style={{ color: 'var(--border)' }}>·</span>
        <span style={{ fontSize: 10, color: 'var(--accent)', animation: 'pulse 1s infinite' }}>●</span>
        <span style={{ fontSize: 10 }}>Tracing txs… {cache.done}/{cache.total} ({pct}%)</span>
      </div>
    )
  }

  // Stats ready
  const score = parallelStats?.score ?? 0
  const scoreColor = score >= 0.8 ? 'var(--green)' : score >= 0.5 ? '#ffb74d' : 'var(--red)'

  const roCount = readOnlyStats?.count ?? 0
  const roTxPct = readOnlyStats?.txPct ?? 0
  const roGasPct = readOnlyStats?.gasPct

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      {([
        {
          label: 'Parallel Score',
          value: `${(score * 100).toFixed(0)}%`,
          color: scoreColor,
          title: "How parallelizable this block's txs are (1 = fully independent)",
        },
        {
          label: 'Chain',
          value: parallelStats?.criticalPath?.toString() ?? '—',
          title: 'Minimum sequential batches needed (critical path length)',
        },
        {
          label: 'Peak Parallel',
          value: parallelStats?.maxConcurrent?.toString() ?? '—',
          title: 'Max txs that can execute concurrently in the widest batch',
        },
        {
          label: 'Conflicted Txs',
          value: parallelStats ? `${parallelStats.conflictedTxs}/${parallelStats.totalTxs}` : '—',
          title: 'Txs with RAW or WAW state dependency on a prior tx',
        },
        {
          label: 'Read-only Txs',
          value: `${roCount} (${roTxPct}% txs${roGasPct !== null ? ` · ${roGasPct}% gas` : ''})`,
          title: 'Txs with no storage writes and no ETH balance transfers',
        },
      ] as { label: string; value: string; color?: string; title: string }[]).map(({ label, value, color, title }) => (
        <div key={label} style={{ padding: '5px 12px', borderRight: '1px solid var(--border)' }} title={title}>
          <div className="stat-label">{label}</div>
          <div className="stat-value" style={{ fontSize: 11, color: color ?? 'var(--text)' }}>{value}</div>
        </div>
      ))}
    </div>
  )
}

// ── Main block view ───────────────────────────────────────────────────────

export function BlockView({ blockNumber }: { blockNumber: number }) {
  const { blocks, blockLoading, fetchBlock, connected } = useStore()
  const [selectedTx, setSelectedTx] = useState<string | null>(null)
  const [txTypeFilter, setTxTypeFilter] = useState<TxFilter>('all')
  const [histFilter, setHistFilter] = useState<HistogramFilter>(EMPTY_HIST_FILTER)
  const [sortBy, setSortBy] = useState<SortKey>('txs')
  const txListRef = useRef<HTMLDivElement>(null)

  // When a tx is selected from the sankey, scroll it into view in the list
  useEffect(() => {
    if (!selectedTx || !txListRef.current) return
    const el = txListRef.current.querySelector<HTMLElement>(`[data-txhash="${selectedTx}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedTx])

  // Fetch block on demand if not in cache (e.g. navigated via URL)
  useEffect(() => {
    if (!blocks.has(blockNumber) && connected) fetchBlock(blockNumber)
  }, [blockNumber, connected])

  const block = blocks.get(blockNumber)
  const loading = blockLoading.has(blockNumber)

  if (!block) {
    return (
      <div className="empty-state">
        {loading
          ? <>Fetching block #{blockNumber.toLocaleString()}…<br /><div className="shimmer" style={{ width: 200, margin: '12px auto' }} /></>
          : connected
            ? <>Block #{blockNumber.toLocaleString()} not found.<br /><span className="muted">The node may not have this block.</span></>
            : <>Connect to load block #{blockNumber.toLocaleString()}</>
        }
      </div>
    )
  }

  const filteredTxs = block.transactions.filter((tx) => {
    if (txTypeFilter === 'eth')    { if (tx.value === 0n) return false }
    if (txTypeFilter === 'tokens') { if (tx.tokenFlows.length === 0) return false }
    if (txTypeFilter === 'defi')   { if (tx.protocols.length === 0) return false }
    if (histFilter.sender    && tx.from !== histFilter.sender) return false
    if (histFilter.recipient && tx.to   !== histFilter.recipient) return false
    if (histFilter.selector  && tx.methodSelector !== histFilter.selector) return false
    return true
  })

  const selectedTxObj = selectedTx ? block.transactions.find((t) => t.hash === selectedTx) : null

  const hasHistFilter = histFilter.sender !== null || histFilter.recipient !== null || histFilter.selector !== null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Block nav + stats */}
      <BlockHeader blockNumber={blockNumber} />

      {/* Trace-derived stats (parallelization, read-only) */}
      <TraceStatsBar block={block} />

      {/* Collapsible histograms — tx aggregations */}
      <BlockHistograms blockNumber={blockNumber} filter={histFilter} onFilter={setHistFilter} sortBy={sortBy} onSortBy={setSortBy} />

      {/* Call aggregations */}
      <CollapsibleCallAggregations block={block} />

      {/* State access */}
      <CollapsibleStateAccess block={block} onSelectTx={setSelectedTx} />

      {/* Value flow */}
      <CollapsibleMetaSankey block={block} />

      {/* Protocol activity */}
      <CollapsibleProtocols block={block} onSelectTx={(h) => setSelectedTx(h)} />

      {/* Cross-tx account patterns */}
      <AccountActivity block={block} onSelectTx={(h) => setSelectedTx(h)} />

      {/* Filter bar */}
      <div style={{
        display: 'flex', gap: 4, padding: '4px 8px',
        borderBottom: '1px solid var(--border)', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap',
      }}>
        {(['all', 'eth', 'tokens', 'defi'] as TxFilter[]).map((f) => (
          <button
            key={f}
            className={`topbar-btn ${txTypeFilter === f ? 'active' : ''}`}
            style={{ fontSize: 10, padding: '2px 8px', textTransform: 'capitalize' }}
            onClick={() => setTxTypeFilter(f)}
          >
            {f}
          </button>
        ))}

        {/* Active histogram filter chips */}
        {histFilter.sender && (
          <span className="badge" style={{ fontSize: 9, background: 'var(--surface2)', color: 'var(--accent)', cursor: 'pointer' }}
            onClick={() => setHistFilter({ ...histFilter, sender: null })}>
            from:{histFilter.sender.slice(0, 8)}… ×
          </span>
        )}
        {histFilter.recipient && (
          <span className="badge" style={{ fontSize: 9, background: 'var(--surface2)', color: 'var(--accent)', cursor: 'pointer' }}
            onClick={() => setHistFilter({ ...histFilter, recipient: null })}>
            to:{histFilter.recipient.slice(0, 8)}… ×
          </span>
        )}
        {histFilter.selector && (
          <span className="badge" style={{ fontSize: 9, background: 'var(--surface2)', color: 'var(--accent)', cursor: 'pointer' }}
            onClick={() => setHistFilter({ ...histFilter, selector: null })}>
            fn:{KNOWN_SELECTORS[histFilter.selector] ?? histFilter.selector} ×
          </span>
        )}
        {hasHistFilter && (
          <button className="topbar-btn" style={{ fontSize: 9, padding: '1px 6px' }}
            onClick={() => setHistFilter(EMPTY_HIST_FILTER)}>
            clear filters
          </button>
        )}

        <span className="muted" style={{ marginLeft: 'auto', fontSize: 10 }}>
          {filteredTxs.length}/{block.transactions.length} txs
        </span>
      </div>

      {/* Tx list + optional detail panel */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <div
          ref={txListRef}
          className="scroll-y"
          style={{
            flex: selectedTxObj ? '0 0 60%' : '1',
            borderRight: selectedTxObj ? '1px solid var(--border)' : 'none',
            overflow: 'hidden auto',
          }}
        >
          {filteredTxs.map((tx) => (
            <div key={tx.hash} data-txhash={tx.hash}>
              <TxRow
                tx={tx}
                baseFee={block.baseFeePerGas}
                selected={tx.hash === selectedTx}
                onClick={() => setSelectedTx(tx.hash === selectedTx ? null : tx.hash)}
              />
            </div>
          ))}
          {filteredTxs.length === 0 && <div className="empty-state">No txs match filter</div>}
        </div>

        {selectedTxObj && (
          <div style={{ flex: '0 0 40%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <TxQuickDetail tx={selectedTxObj} blockNumber={blockNumber} />
          </div>
        )}
      </div>
    </div>
  )
}
