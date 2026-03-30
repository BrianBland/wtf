import { useState } from 'react'
import { hexColors } from '../lib/colorize'
import { KNOWN_TOKENS, KNOWN_PROTOCOLS, KNOWN_SELECTORS, PROTOCOL_COLORS } from '../lib/protocols'
import { shortAddr, formatPercent, formatNumber, formatGas } from '../lib/formatters'
import { AggMetric } from '../lib/aggregations'

export interface HistEntry {
  key:   string
  count: number  // tx count
  gas:   number  // Kgas (gasUsed when available, else gasLimit)
}

export type SortKey = AggMetric  // 'txs' | 'gas'
type HistType = 'address' | 'selector' | 'other'

interface HistogramProps {
  entries: HistEntry[]
  type?: HistType
  label?: string
  maxRows?: number
  onSelect?: (key: string) => void
  selectedKey?: string | null
  sortBy?: SortKey
}

function resolveLabel(key: string, type: HistType): string {
  if (type === 'address') {
    const addr = key.toLowerCase()
    const token = KNOWN_TOKENS[addr]
    if (token) return token.symbol
    const proto = KNOWN_PROTOCOLS[addr]
    if (proto) return proto.name
    return shortAddr(key)
  }
  if (type === 'selector') {
    return KNOWN_SELECTORS[key] ?? key
  }
  return key
}

export function Histogram({ entries, type = 'address', maxRows = 8, onSelect, selectedKey, sortBy = 'txs' }: HistogramProps) {
  const [expanded, setExpanded] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const copyKey = (key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(key)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1200)
  }

  const sorted = [...entries].sort((a, b) =>
    sortBy === 'gas' ? b.gas - a.gas : b.count - a.count
  )
  const totalCount = sorted.reduce((s, e) => s + e.count, 0)
  const totalGas   = sorted.reduce((s, e) => s + e.gas, 0)
  const maxVal     = sorted[0] ? (sortBy === 'gas' ? sorted[0].gas : sorted[0].count) : 1

  const shown   = expanded ? sorted : sorted.slice(0, maxRows)
  const hiddenN = sorted.length - maxRows

  return (
    <div className="histogram">
      {shown.map(({ key, count, gas }) => {
        const val      = sortBy === 'gas' ? gas : count
        const total    = sortBy === 'gas' ? totalGas : totalCount
        const pct      = val / (maxVal || 1)
        const bg       = (type === 'other' ? PROTOCOL_COLORS[key] : undefined) ?? hexColors(key).bg
        const isActive = selectedKey === key
        const label_   = resolveLabel(key, type)

        return (
          <div
            className="hist-row"
            key={key}
            title={onSelect ? `Click to filter by ${label_}` : key}
            style={{
              cursor: onSelect ? 'pointer' : undefined,
              background: isActive ? 'var(--surface2)' : undefined,
              outline: isActive ? `1px solid ${bg}` : undefined,
            }}
            onClick={onSelect ? () => onSelect(key) : undefined}
          >
            <div className="flex-center gap4" style={{ overflow: 'hidden' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8, height: 8,
                  borderRadius: 1,
                  background: bg,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 11,
                  fontWeight: isActive ? 700 : undefined,
                  cursor: type === 'address' ? 'copy' : undefined,
                }}
                title={type === 'address' ? `${key} (click to copy)` : key}
                onClick={type === 'address' ? (e) => copyKey(key, e) : undefined}
              >
                {copiedKey === key ? '✓ copied' : label_}
              </span>
            </div>
            <div className="hist-bar-wrap">
              <div className="hist-bar" style={{ width: `${pct * 100}%`, background: bg }} />
            </div>
            <span className="hist-count" style={{ gap: 3, display: 'flex', alignItems: 'center' }}>
              <span style={{ color: sortBy === 'txs' ? 'var(--text)' : 'var(--text3)', fontVariantNumeric: 'tabular-nums' }}
                title="Transaction count">
                {formatNumber(count)}
              </span>
              <span style={{ color: 'var(--border)', fontSize: 9 }}>·</span>
              <span style={{ color: sortBy === 'gas' ? 'var(--text)' : 'var(--text3)', fontVariantNumeric: 'tabular-nums' }}
                title="Gas limit (sum of tx.gasLimit — approximates usage)">
                {formatGas(BigInt(Math.round(gas * 1000)))}
              </span>
            </span>
            <span className="hist-pct">{formatPercent(val, total)}</span>
          </div>
        )
      })}

      {!expanded && hiddenN > 0 && (
        <div
          className="clist-toggle"
          style={{ justifyContent: 'center', cursor: 'pointer' }}
          onClick={() => setExpanded(true)}
        >
          ▼ {hiddenN} more ({sorted.length} total)
        </div>
      )}
      {expanded && (
        <div
          className="clist-toggle"
          style={{ justifyContent: 'center', cursor: 'pointer' }}
          onClick={() => setExpanded(false)}
        >
          ▲ Collapse
        </div>
      )}
    </div>
  )
}
