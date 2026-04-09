import { useMemo, useState } from 'react'
import { CallTrace } from '../types'

import { formatGas, hexToBigInt } from '../lib/formatters'
import { hexColors } from '../lib/colorize'
import { HexTag, SelectorTag } from './HexTag'
import { compareBigIntDesc } from '../lib/bigintMath'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CallRecord {
  contract: string
  selector: string | null  // first 4 bytes of input, or null
  gasUsed:  bigint
  txHash:   string
}

interface CallStat {
  contract:  string
  selector:  string | null
  callCount: number
  txCount:   number
  gasUsed:   bigint
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function flattenCalls(trace: CallTrace, txHash: string): CallRecord[] {
  const result: CallRecord[] = []
  if (trace.to) {
    const input = trace.input ?? ''
    result.push({
      contract: trace.to.toLowerCase(),
      selector: input.length >= 10 && input !== '0x' ? input.slice(0, 10).toLowerCase() : null,
      gasUsed:  hexToBigInt(trace.gasUsed),
      txHash,
    })
  }
  for (const sub of trace.calls ?? []) {
    result.push(...flattenCalls(sub, txHash))
  }
  return result
}

function aggregateCalls(callResults: Map<string, CallTrace>): CallStat[] {
  const byKey = new Map<string, {
    contract: string; selector: string | null
    callCount: number; txHashes: Set<string>; gasUsed: bigint
  }>()

  for (const [txHash, trace] of callResults) {
    const records = flattenCalls(trace, txHash)
    for (const r of records) {
      const key = `${r.contract}::${r.selector ?? ''}`
      const existing = byKey.get(key)
      if (existing) {
        existing.callCount++
        existing.txHashes.add(r.txHash)
        existing.gasUsed += r.gasUsed
      } else {
        byKey.set(key, {
          contract:  r.contract,
          selector:  r.selector,
          callCount: 1,
          txHashes:  new Set([r.txHash]),
          gasUsed:   r.gasUsed,
        })
      }
    }
  }

  return [...byKey.values()].map((v) => ({
    contract:  v.contract,
    selector:  v.selector,
    callCount: v.callCount,
    txCount:   v.txHashes.size,
    gasUsed:   v.gasUsed,
  }))
}

// ── Component ─────────────────────────────────────────────────────────────────

type SortKey = 'calls' | 'gas' | 'txs'

export function CallAggregationsView({
  callResults,
}: {
  callResults: Map<string, CallTrace>
}) {
  const [sortBy, setSortBy] = useState<SortKey>('calls')

  const stats = useMemo(() => aggregateCalls(callResults), [callResults])

  const sorted = useMemo(() => {
    return [...stats].sort((a, b) => {
      if (sortBy === 'gas')  return compareBigIntDesc(a.gasUsed, b.gasUsed)
      if (sortBy === 'txs')  return b.txCount - a.txCount
      return b.callCount - a.callCount
    })
  }, [stats, sortBy])

  const maxCalls = Math.max(...sorted.map((s) => s.callCount), 1)
  const maxGas   = sorted.reduce((m, s) => s.gasUsed > m ? s.gasUsed : m, 0n) || 1n

  if (stats.length === 0) {
    return <div className="empty-state" style={{ padding: 16 }}>No call data</div>
  }

  const uniqueContracts = new Set(stats.map((s) => s.contract)).size

  return (
    <div>
      <div className="panel-header" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
        <span style={{ color: 'var(--text2)' }}>{uniqueContracts} contracts · {stats.length} call types</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 3, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: 'var(--text3)' }}>sort:</span>
          {([['calls', 'calls'], ['gas', 'gas'], ['txs', 'txs']] as [SortKey, string][]).map(([key, label]) => (
            <button
              key={key}
              className={`topbar-btn ${sortBy === key ? 'active' : ''}`}
              style={{ fontSize: 9, padding: '1px 7px' }}
              onClick={() => setSortBy(key)}
            >{label}</button>
          ))}
        </div>
      </div>

      {sorted.map((s, i) => {
        const { bg } = hexColors(s.contract)
        const barW   = sortBy === 'gas'
          ? Number((s.gasUsed * 100n) / maxGas)
          : Math.round((s.callCount / maxCalls) * 100)

        return (
          <div
            key={i}
            className="data-row"
            style={{ gap: 4, paddingRight: 8, position: 'relative', overflow: 'hidden' }}
          >
            {/* Background bar */}
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: `${barW}%`,
              background: bg,
              opacity: 0.12,
              pointerEvents: 'none',
            }} />

            {/* Contract — uses HexTag for copy + consistent coloring */}
            <div style={{ minWidth: 90, flexShrink: 0 }}>
              <HexTag value={s.contract} type="address" />
            </div>

            {/* Selector */}
            <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
              <SelectorTag selector={s.selector} />
            </div>

            {/* Call count */}
            <span style={{ minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 10 }}>
              {s.callCount}
              <span className="muted" style={{ fontSize: 9 }}> calls</span>
            </span>

            {/* Tx count */}
            <span className="muted" style={{ minWidth: 32, textAlign: 'right', fontSize: 9 }}>
              {s.txCount}tx
            </span>

            {/* Gas */}
            <span className="muted" style={{ minWidth: 52, textAlign: 'right', fontSize: 9 }}>
              {formatGas(s.gasUsed)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
