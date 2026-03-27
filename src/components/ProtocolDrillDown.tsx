import { useEffect, useMemo, useState } from 'react'
import { Block } from '../types'
import { buildPoolActivity, groupByProtocol, PoolSummary } from '../lib/poolActivity'
import { useStore, Store } from '../store'
import { shortAddr, formatAmount, formatEth } from '../lib/formatters'
import { hexColors } from '../lib/colorize'
import { KNOWN_TOKENS, KNOWN_PROTOCOLS } from '../lib/protocols'
import { PoolMeta } from '../lib/poolFetch'
import { PoolFlowView } from './PoolFlowView'

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

// ── Pool row ──────────────────────────────────────────────────────────────

function PoolRow({
  pool,
  poolMeta,
  tokenCache,
  blocks,
  onSelectTx,
  expanded,
  onToggle,
}: {
  pool: PoolSummary
  poolMeta?: PoolMeta
  tokenCache: Store['tokenCache']
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

          {/* Tx hash list */}
          <div style={{ padding: '2px 0 4px 0' }}>
            {pool.txHashes.map((hash) => (
              <div
                key={hash}
                className="data-row"
                style={{ paddingLeft: 36, cursor:'pointer', gap:6 }}
                onClick={() => onSelectTx(hash)}
              >
                <span style={{ fontSize:9, color:'var(--accent)', fontFamily:'monospace' }}>
                  {hash.slice(0, 10)}…{hash.slice(-6)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ── Protocol section ──────────────────────────────────────────────────────

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
  // Fallback
  'Unknown':         'var(--text3)',
}

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

// ── Main export ───────────────────────────────────────────────────────────

export function ProtocolDrillDown({
  blocks,
  onSelectTx,
}: {
  blocks: Block[]
  onSelectTx: (hash: string) => void
}) {
  const { poolCache, fetchPool, tokenCache, fetchToken } = useStore()

  // Build flat pool activity map
  const flatPools = useMemo(() => buildPoolActivity(blocks), [blocks])

  // Trigger on-demand fetches for all unique pool + token addresses
  useEffect(() => {
    for (const addr of flatPools.keys()) fetchPool(addr)
  }, [flatPools, fetchPool])

  useEffect(() => {
    for (const meta of poolCache.values()) {
      if (typeof meta !== 'object') continue
      if (meta.token0) fetchToken(meta.token0)
      if (meta.token1) fetchToken(meta.token1)
    }
  }, [poolCache, fetchToken])

  // Group by factory-resolved protocol (falls back to event protocol)
  const groups = useMemo(() => {
    const resolve = (addr: string): string | undefined => {
      const m = poolCache.get(addr)
      // Return factory-resolved protocol when known, including 'Unknown'.
      // Returning 'Unknown' (instead of undefined) prevents falling back to
      // the eventProtocols which may contain stale 'Uniswap V3' guesses.
      if (typeof m === 'object') return m.protocol
      return undefined  // still loading or error — fall back to eventProtocols
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

  return (
    <div>
      {sortedGroups.map(([protocol, pools]) => (
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
