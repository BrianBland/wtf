import { useEffect, useMemo, useState } from 'react'
import { Block, Transaction } from '../types'
import { buildPoolActivity, groupByProtocol, PoolSummary } from '../lib/poolActivity'
import { useStore, Store } from '../store'
import { shortAddr, formatAmount, formatEth } from '../lib/formatters'
import { hexColors } from '../lib/colorize'
import { KNOWN_TOKENS, KNOWN_PROTOCOLS, PROTOCOL_COLORS, PROTOCOL_CLASSIFICATION } from '../lib/protocols'
import { PoolMeta } from '../lib/poolFetch'
import { PoolFlowView } from './PoolFlowView'
import { usePrefetchPoolMetadata } from '../hooks/usePrefetchMetadata'

// ── Token pair label ──────────────────────────────────────────────────────

function tokenSymbol(addr: string, tokenCache: Store['tokenCache']): string {
  const known = KNOWN_TOKENS[addr]
  if (known) return known.symbol
  const cached = tokenCache.get(addr)
  if (cached && typeof cached === 'object') return cached.symbol
  return addr.slice(2, 6).toUpperCase()
}

function PairLabel({ meta, tokenCache }: { meta: PoolMeta; tokenCache: Store['tokenCache'] }) {
  const sym0 = meta.token0 ? tokenSymbol(meta.token0, tokenCache) : '?'
  const sym1 = meta.token1 ? tokenSymbol(meta.token1, tokenCache) : '?'
  return (
    <span style={{ fontSize: 10, color: 'var(--text2)', fontWeight: 600 }}>
      {sym0}/{sym1}
    </span>
  )
}

// ── Inline tx action summary ──────────────────────────────────────────────

function txActionSummary(
  tx: Transaction,
  poolAddr: string,
  tokenCacheRef: Store['tokenCache'],
): string | null {
  // Net token flows into/out-of the pool
  const net = new Map<string, bigint>()
  for (const flow of tx.tokenFlows) {
    if (flow.to   === poolAddr) net.set(flow.token, (net.get(flow.token) ?? 0n) + flow.amount)
    if (flow.from === poolAddr) net.set(flow.token, (net.get(flow.token) ?? 0n) - flow.amount)
  }
  if (net.size === 0) return null

  const ins  = [...net.entries()].filter(([, v]) => v > 0n)   // into pool (user sells)
  const outs = [...net.entries()].filter(([, v]) => v < 0n)   // out of pool (user receives)

  const fmt = (addr: string, amt: bigint) => {
    const sym  = tokenSymbol(addr, tokenCacheRef)
    const info = KNOWN_TOKENS[addr]
    const dec  = info?.decimals ?? 18
    const pos  = amt < 0n ? -amt : amt
    return `${formatAmount(pos, dec, 3)} ${sym}`
  }

  // Determine action from tx.protocols (best-effort)
  const actionEv = tx.protocols.find((e) =>
    e.action === 'Swap' || e.action === 'AddLiquidity' || e.action === 'RemoveLiquidity'
  )
  const action = actionEv?.action ?? (ins.length > 0 && outs.length > 0 ? 'Swap' : null)

  if (action === 'Swap' && ins.length === 1 && outs.length === 1) {
    return `Swap ${fmt(ins[0][0], ins[0][1])} → ${fmt(outs[0][0], outs[0][1])}`
  }
  if (action === 'AddLiquidity') {
    return `Add ${ins.map(([a, v]) => fmt(a, v)).join(' + ')}`
  }
  if (action === 'RemoveLiquidity') {
    return `Remove ${outs.map(([a, v]) => fmt(a, v)).join(' + ')}`
  }
  // Fallback for multi-leg or unknown
  const inStr  = ins.map(([a, v])  => fmt(a, v)).join(' + ')
  const outStr = outs.map(([a, v]) => fmt(a, v)).join(' + ')
  if (inStr && outStr) return `${inStr} → ${outStr}`
  return null
}

// ── Pool row ──────────────────────────────────────────────────────────────

function PoolRow({
  pool,
  poolMeta,
  tokenCache,
  txMap,
  blocks,
  onSelectTx,
  expanded,
  onToggle,
}: {
  pool: PoolSummary
  poolMeta?: PoolMeta
  tokenCache: Store['tokenCache']
  txMap: Map<string, Transaction>
  blocks: Block[]
  onSelectTx: (hash: string) => void
  expanded: boolean
  onToggle: () => void
}) {
  const { bg } = hexColors(pool.pool)
  const knownName  = KNOWN_PROTOCOLS[pool.pool]?.name
  const usdcAmt = pool.usdcVolume > 0n ? formatAmount(pool.usdcVolume, 6, 0) : null
  const wethAmt = pool.wethVolume > 0n ? formatEth(pool.wethVolume, 3) : null
  const hasActivity = pool.swaps + pool.lpAdds + pool.lpRemoves > 0
  const [copied, setCopied] = useState(false)
  const copyAddr = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(pool.pool)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <>
      <div
        className="data-row"
        style={{ paddingLeft: 20, cursor: 'pointer', gap: 6, minHeight: 24 }}
        onClick={onToggle}
      >
        <span style={{ display:'inline-block', width:6, height:6, borderRadius:1, background:bg, flexShrink:0, marginTop:1 }} />

        {/* Pool identity */}
        <span style={{ fontSize: 10, color: 'var(--text2)', minWidth: 0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
          title={pool.pool}>
          {poolMeta
            ? <PairLabel meta={poolMeta} tokenCache={tokenCache} />
            : (knownName ?? shortAddr(pool.pool, 4))}
        </span>
        {poolMeta && (
          <span className="muted" style={{ fontSize: 9, flexShrink: 0, cursor: 'copy' }}
            title={`${pool.pool} (click to copy)`} onClick={copyAddr}>
            {copied ? '✓' : shortAddr(pool.pool, 3)}
          </span>
        )}

        {/* Action counts */}
        {hasActivity && (
          <div style={{ display: 'flex', gap: 3, flexShrink: 0, marginLeft: 2 }}>
            {pool.swaps > 0 && (
              <span className="badge" style={{ background:'var(--surface3)', fontSize:9 }}>⇄ {pool.swaps}</span>
            )}
            {pool.lpAdds > 0 && (
              <span className="badge green" style={{ fontSize:9 }}>+{pool.lpAdds} LP</span>
            )}
            {pool.lpRemoves > 0 && (
              <span className="badge" style={{ background:'var(--red)', color:'white', fontSize:9 }}>−{pool.lpRemoves}</span>
            )}
            {pool.fees > 0 && (
              <span className="badge muted" style={{ fontSize:9 }}>★</span>
            )}
          </div>
        )}

        {/* Volume */}
        <div style={{ marginLeft: 'auto', display:'flex', gap:4, flexShrink:0, alignItems:'center' }}>
          {usdcAmt && (
            <span style={{ fontSize:10, color:'var(--text2)' }}>${usdcAmt}</span>
          )}
          {!usdcAmt && wethAmt && (
            <span style={{ fontSize:10, color:'var(--text3)' }}>{wethAmt}Ξ</span>
          )}
          <span style={{ fontSize:9, color:'var(--text3)', width:8 }}>
            {pool.txHashes.length > 0 ? (expanded ? '▾' : '▸') : ''}
          </span>
        </div>
      </div>

      {expanded && (
        <div style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
          {/* Flow visualization */}
          {poolMeta && poolMeta.token0 && poolMeta.token1 && (
            <PoolFlowView blocks={blocks} poolAddr={pool.pool} meta={poolMeta} />
          )}

          {/* Tx hash list with inline action summaries */}
          <div style={{ padding: '2px 0 4px 0' }}>
            {pool.txHashes.map((hash) => {
              const tx = txMap.get(hash)
              const summary = tx ? txActionSummary(tx, pool.pool, tokenCache) : null
              return (
                <div
                  key={hash}
                  className="data-row"
                  style={{ paddingLeft: 36, cursor:'pointer', gap:8 }}
                  onClick={() => onSelectTx(hash)}
                >
                  <span style={{ fontSize:9, color:'var(--accent)', fontFamily:'monospace', flexShrink:0 }}>
                    {hash.slice(0, 10)}…{hash.slice(-6)}
                  </span>
                  {summary && (
                    <span style={{ fontSize:9, color:'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {summary}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

// ── Protocol section ──────────────────────────────────────────────────────

function ProtocolSection({
  protocol,
  pools,
  blocks,
  poolCache,
  tokenCache,
  onSelectTx,
}: {
  protocol: string
  pools: PoolSummary[]
  blocks: Block[]
  poolCache: Store['poolCache']
  tokenCache: Store['tokenCache']
  onSelectTx: (hash: string) => void
}) {
  const [open, setOpen]         = useState(true)
  const [expandedPool, setExpandedPool] = useState<string | null>(null)

  const txMap = useMemo(() => {
    const m = new Map<string, Transaction>()
    for (const block of blocks) for (const tx of block.transactions) m.set(tx.hash, tx)
    return m
  }, [blocks])

  const sorted = [...pools].sort((a, b) =>
    (b.swaps + b.lpAdds + b.lpRemoves) - (a.swaps + a.lpAdds + a.lpRemoves)
  )
  const totalSwaps = sorted.reduce((s, p) => s + p.swaps, 0)
  const totalLp    = sorted.reduce((s, p) => s + p.lpAdds + p.lpRemoves, 0)
  const color      = PROTOCOL_COLORS[protocol] ?? 'var(--accent)'

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        className="panel-header"
        style={{ cursor:'pointer', gap:6 }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ display:'inline-block', width:8, height:8, borderRadius:2, background:color, flexShrink:0 }} />
        <span style={{ fontWeight:600, fontSize:11 }}>{protocol}</span>
        <span className="count">
          {sorted.length} pool{sorted.length !== 1 ? 's' : ''}
          {totalSwaps > 0 && ` · ${totalSwaps} swap${totalSwaps !== 1 ? 's' : ''}`}
          {totalLp > 0    && ` · ${totalLp} LP`}
        </span>
        <span style={{ marginLeft:'auto', fontSize:9, color:'var(--text3)' }}>
          {open ? '▾' : '▸'}
        </span>
      </div>

      {open && sorted.map((pool) => {
        const meta = poolCache.get(pool.pool)
        const poolMeta = typeof meta === 'object' ? meta : undefined
        return (
          <PoolRow
            key={pool.pool}
            pool={pool}
            poolMeta={poolMeta}
            tokenCache={tokenCache}
            txMap={txMap}
            blocks={blocks}
            onSelectTx={onSelectTx}
            expanded={expandedPool === pool.pool}
            onToggle={() => setExpandedPool(expandedPool === pool.pool ? null : pool.pool)}
          />
        )
      })}
    </div>
  )
}

// ── Classification group ──────────────────────────────────────────────────

const CLASS_ORDER = ['Concentrated Liquidity', 'Classic AMM', 'Lending', 'Other']

function ClassificationGroup({
  label,
  entries,
  blocks,
  poolCache,
  tokenCache,
  onSelectTx,
}: {
  label: string
  entries: [string, PoolSummary[]][]
  blocks: Block[]
  poolCache: Store['poolCache']
  tokenCache: Store['tokenCache']
  onSelectTx: (hash: string) => void
}) {
  const [open, setOpen] = useState(true)
  const totalPools = entries.reduce((s, [, p]) => s + p.length, 0)
  const totalSwaps = entries.reduce((s, [, p]) => s + p.reduce((ss, pp) => ss + pp.swaps, 0), 0)
  const totalLp    = entries.reduce((s, [, p]) => s + p.reduce((ss, pp) => ss + pp.lpAdds + pp.lpRemoves, 0), 0)

  return (
    <div>
      <div
        className="panel-header"
        style={{ cursor: 'pointer', background: 'var(--surface3)', userSelect: 'none' }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ fontSize: 9, color: 'var(--text3)', marginRight: 4 }}>{open ? '▼' : '▶'}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </span>
        <span className="count">
          {totalPools} pool{totalPools !== 1 ? 's' : ''}
          {totalSwaps > 0 && ` · ${totalSwaps} swap${totalSwaps !== 1 ? 's' : ''}`}
          {totalLp > 0    && ` · ${totalLp} LP`}
        </span>
      </div>
      {open && entries.map(([protocol, pools]) => (
        <ProtocolSection
          key={protocol}
          protocol={protocol}
          pools={pools}
          blocks={blocks}
          poolCache={poolCache}
          tokenCache={tokenCache}
          onSelectTx={onSelectTx}
        />
      ))}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────

export function ProtocolDrillDown({
  blocks,
  onSelectTx,
}: {
  blocks: Block[]
  onSelectTx: (hash: string) => void
}) {
  const { poolCache, tokenCache } = useStore()

  // Build flat pool activity map
  const flatPools = useMemo(() => buildPoolActivity(blocks), [blocks])

  usePrefetchPoolMetadata(flatPools.keys())

  // Group by factory-resolved protocol (falls back to event protocol)
  const groups = useMemo(() => {
    const resolve = (addr: string): string | undefined => {
      const m = poolCache.get(addr)
      // Only trust factory-resolved protocol when it's a recognized protocol.
      // Returning undefined for 'Unknown' lets groupByProtocol fall back to the
      // event-derived protocol, which correctly classifies CL vs Classic AMM pools
      // with unrecognized factories.
      if (typeof m === 'object' && m.protocol !== 'Unknown') return m.protocol
      return undefined  // still loading, error, or unknown factory — fall back to eventProtocols
    }
    return groupByProtocol(flatPools, resolve)
  }, [flatPools, poolCache])

  if (groups.size === 0) {
    return <div className="muted" style={{ padding:'8px 12px', fontSize:11 }}>No protocol events</div>
  }

  // Sort protocol groups by total activity
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const sum = (pools: PoolSummary[]) => pools.reduce((s, p) => s + p.swaps + p.lpAdds + p.lpRemoves, 0)
    return sum(b[1]) - sum(a[1])
  })

  // Group by classification
  const byClass = new Map<string, [string, PoolSummary[]][]>()
  for (const entry of sortedGroups) {
    const cls = PROTOCOL_CLASSIFICATION[entry[0]] ?? 'Other'
    if (!byClass.has(cls)) byClass.set(cls, [])
    byClass.get(cls)!.push(entry)
  }
  const classEntries = CLASS_ORDER
    .filter((c) => byClass.has(c))
    .map((c) => [c, byClass.get(c)!] as const)

  return (
    <div>
      {classEntries.map(([cls, entries]) => (
        <ClassificationGroup
          key={cls}
          label={cls}
          entries={entries}
          blocks={blocks}
          poolCache={poolCache}
          tokenCache={tokenCache}
          onSelectTx={onSelectTx}
        />
      ))}
    </div>
  )
}
