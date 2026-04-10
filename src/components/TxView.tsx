import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { CallTrace, Log } from '../types'
import { HexTag, SelectorTag, TopicTag } from './HexTag'
import { CollapsibleList } from './CollapsibleList'
import { TokenFlowList, EthFlowList, ProtocolEventList, NetFlowSummary } from './ValueFlow'
import { KNOWN_PROTOCOLS, KNOWN_TOKENS } from '../lib/protocols'
import {
  formatEth, formatGas, formatNumber, shortAddr,
  hexToBigInt,
} from '../lib/formatters'
import {
  decodeCalldata,
  decodeCalldataFromSig,
  decodeLog,
  EVENT_ABI_MAP,
  DecodedValue,
  DecodedParam,
  DecodedCall,
  hasKnownFunctionAbi,
} from '../lib/calldataDecoder'
import { getCachedSelector, lookupSelector, getCachedEventTopic, lookupEventTopic } from '../lib/fourByte'
import { useCachedLookup } from '../hooks/useCachedLookup'
import { carryBlockFilters } from '../lib/urlState'

// ── Decoded calldata view ─────────────────────────────────────────────────

// Muted but distinct palette for ABI word slots — cycles by index so
// adjacent words always differ, without relying on per-value hashing.
const WORD_COLORS = [
  '#8aabcc', // muted blue
  '#7aaa8a', // muted green
  '#c49a70', // muted orange
  '#9a88b8', // muted purple
  '#5a9898', // muted teal
  '#b0a060', // muted amber
]

function DecodedValueDisplay({ value, type }: { value: DecodedValue; type: string }) {
  switch (value.kind) {
    case 'address':
      return <HexTag value={value.hex} type="address" />
    case 'bool':
      return (
        <span className="badge" style={{ background: value.value ? 'var(--green)' : 'var(--surface3)', fontSize: 9 }}>
          {value.value ? 'true' : 'false'}
        </span>
      )
    case 'uint':
    case 'int': {
      const n = value.value
      const s = n < 0n ? '-' + (-n).toString() : n.toString()
      const display = s.length > 20 ? s.slice(0, 10) + '…' + s.slice(-6) : s
      return <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 10 }} title={s}>{display}</span>
    }
    case 'bytes_fixed':
      return <span style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 9 }}>{value.hex.slice(0, 18)}{value.hex.length > 18 ? '…' : ''}</span>
    case 'bytes': {
      const h = value.hex
      const preview = h.length > 34 ? h.slice(0, 18) + '…' + h.slice(-6) : h
      return <span style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 9 }} title={h}>{preview}</span>
    }
    case 'string':
      return <span style={{ color: 'var(--text2)', fontSize: 10 }}>"{value.value}"</span>
    case 'tuple':
      return <DecodedTupleDisplay fields={value.fields} />
    case 'array': {
      const elemName = value.elementType
      if (value.elements.length === 0) {
        return <span style={{ color: 'var(--text3)', fontSize: 9 }}>{elemName}[]</span>
      }
      return (
        <div style={{ width: '100%' }}>
          <span style={{ color: 'var(--text3)', fontSize: 9 }}>
            {elemName}[{value.total}]{value.total > value.elements.length ? ` (${value.elements.length} decoded)` : ''}
          </span>
          {value.elements.map((elem, i) => (
            <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'flex-start', marginTop: 2 }}>
              <span style={{ color: 'var(--text3)', fontSize: 9, flexShrink: 0, minWidth: 20 }}>[{i}]</span>
              <DecodedValueDisplay value={elem} type={elemName} />
            </div>
          ))}
        </div>
      )
    }
    default:
      return <span style={{ color: 'var(--text3)', fontSize: 9 }}>{type}</span>
  }
}

function DecodedTupleDisplay({ fields }: { fields: DecodedParam[] }) {
  return (
    <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 8, marginTop: 2 }}>
      {fields.map((f, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', minHeight: 18 }}>
          <span style={{ color: 'var(--text3)', fontSize: 9, minWidth: 0, flexShrink: 0 }}>{f.name}:</span>
          <DecodedValueDisplay value={f.value} type={f.type} />
        </div>
      ))}
    </div>
  )
}

// ── Decoded log view ──────────────────────────────────────────────────────

function DecodedLogView({ log }: { log: Log }) {
  const topic0 = log.topics[0]
  const resolvedTopicSig = useCachedLookup(
    topic0 ?? '',
    getCachedEventTopic,
    lookupEventTopic,
  )
  const sig = !topic0 || topic0 in EVENT_ABI_MAP ? null : resolvedTopicSig

  const decoded = topic0 ? decodeLog(log.topics, log.data, topic0, sig ?? undefined) : null

  if (decoded && decoded.params.length > 0) {
    return (
      <div style={{
        background: 'var(--surface2)', border: '1px solid var(--border)',
        borderRadius: 2, padding: '4px 8px', marginTop: 4,
      }}>
        {decoded.params.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 18 }}>
            <span style={{
              color: p.indexed ? 'var(--purple)' : 'var(--text3)',
              fontSize: 9, minWidth: 72, flexShrink: 0,
            }}>{p.name}</span>
            <DecodedValueDisplay value={p.value} type={p.type} />
          </div>
        ))}
      </div>
    )
  }

  // Fallback: raw display
  return (
    <>
      {log.topics.map((t, ti) => (
        <div key={ti} className="log-topic">t[{ti}]: {t}</div>
      ))}
      {log.data && log.data !== '0x' && (
        <div className="log-topic" style={{ wordBreak: 'break-all', marginTop: 2 }}>
          data: {log.data}
        </div>
      )}
    </>
  )
}

function useResolvedSelectorSignature(selector: string): string | null {
  return useCachedLookup(selector, getCachedSelector, lookupSelector)
}

function decodeCallWithFallback(input: string, selector: string, sig: string | null): DecodedCall | null {
  const decoded = decodeCalldata(input, selector)
  if (decoded) return decoded
  if (hasKnownFunctionAbi(selector)) return null
  return sig ? decodeCalldataFromSig(input, sig) : null
}

function RawCalldataView({
  input,
  byteLen,
  words,
  openByDefault,
  compact = false,
}: {
  input: string
  byteLen: number
  words: string[]
  openByDefault: boolean
  compact?: boolean
}) {
  return (
    <details open={openByDefault}>
      <summary style={{
        cursor: 'pointer',
        fontSize: 9,
        color: 'var(--text3)',
        userSelect: 'none',
        ...(compact
          ? { padding: '2px 12px' }
          : { marginBottom: 4 }),
      }}>
        raw calldata{compact ? ` (${byteLen} bytes)` : ''}
      </summary>
      <div style={{
        fontSize: 10,
        wordBreak: 'break-all',
        lineHeight: 2,
        fontFamily: 'var(--font-mono)',
        background: 'var(--surface2)',
        ...(compact
          ? { padding: '6px 12px', borderTop: '1px solid var(--border)' }
          : { padding: '8px 10px', borderRadius: 2, border: '1px solid var(--border)' }),
      }}>
        <span style={{ color: 'var(--purple)' }}>{input.slice(0, 10)}</span>
        {words.map((word, i) => (
          <span key={i} style={{ color: WORD_COLORS[i % WORD_COLORS.length] }}>{word}</span>
        ))}
      </div>
    </details>
  )
}

export function DecodedCallView({ input, selector }: { input: string; selector: string }) {
  const sig = useResolvedSelectorSignature(selector)
  const decoded = decodeCallWithFallback(input, selector, sig)

  // Slice calldata body (after 4-byte selector) into 32-byte (64 hex char) words
  const calldataBody = input.slice(10)
  const words: string[] = []
  for (let i = 0; i < calldataBody.length; i += 64) words.push(calldataBody.slice(i, i + 64))

  const hasDecoded = decoded && decoded.params.length > 0
  const byteLen = Math.floor((input.length - 2) / 2)

  if (!decoded) {
    return (
      <div>
        <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
          {selector}
        </div>
        <RawCalldataView
          input={input}
          byteLen={byteLen}
          words={words}
          openByDefault={byteLen <= 100}
          compact
        />
      </div>
    )
  }

  return (
    <div>
      <div style={{ padding: '6px 12px' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', fontWeight: 600, marginBottom: 4 }}>
          {decoded.name}()
        </div>
        {decoded.params.length === 0 && (
          <span style={{ fontSize: 9, color: 'var(--text3)' }}>no args</span>
        )}
        {decoded.params.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'flex-start', marginBottom: 3 }}>
            <span style={{ color: 'var(--text3)', fontSize: 9, flexShrink: 0, paddingTop: 1 }}>{p.name}:</span>
            <DecodedValueDisplay value={p.value} type={p.type} />
          </div>
        ))}
      </div>
      <RawCalldataView
        input={input}
        byteLen={byteLen}
        words={words}
        openByDefault={!hasDecoded && byteLen <= 100}
        compact
      />
    </div>
  )
}

// ── Call trace tree ───────────────────────────────────────────────────────

const MAX_TRACE_DEPTH = 12

function TraceNode({
  node, depth = 0,
}: { node: CallTrace; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 3)

  if (depth > MAX_TRACE_DEPTH) return null

  const hasChildren = node.calls && node.calls.length > 0
  const isError     = !!node.error
  const value       = node.value && node.value !== '0x0' ? hexToBigInt(node.value) : 0n
  const gasUsed     = node.gasUsed ? hexToBigInt(node.gasUsed) : null

  return (
    <div className="trace-node" style={depth === 0 ? { marginLeft: 0, borderLeft: 'none', paddingLeft: 0 } : {}}>
      <div
        className="trace-node-self"
        onClick={() => hasChildren && setExpanded((e) => !e)}
        style={{ cursor: hasChildren ? 'pointer' : 'default' }}
      >
        {/* Expand/collapse toggle */}
        {hasChildren && (
          <span style={{ color: 'var(--text3)', fontSize: 9, minWidth: 10 }}>
            {expanded ? '▼' : '▶'}
          </span>
        )}

        {/* Call type badge */}
        <span className={`trace-type ${node.type}`}>{node.type}</span>

        {/* From → To */}
        {node.from && <HexTag value={node.from} type="address" />}
        <span style={{ color: 'var(--text3)' }}>→</span>
        {node.to && <HexTag value={node.to} type="address" />}

        {/* Method selector */}
        {node.input && node.input.length >= 10 && (
          <SelectorTag selector={node.input.slice(0, 10).toLowerCase()} inputHex={node.input} />
        )}

        {/* ETH value */}
        {value > 0n && (
          <span className="badge amber">{formatEth(value, 4)} ETH</span>
        )}

        {/* Gas used */}
        {gasUsed !== null && (
          <span className="muted" style={{ fontSize: 9, marginLeft: 'auto' }}>
            {formatGas(gasUsed)}
          </span>
        )}

        {/* Error indicator */}
        {isError && (
          <span className="badge red" title={node.error}>{node.error?.slice(0, 20) ?? 'REVERT'}</span>
        )}

        {/* Child count */}
        {hasChildren && !expanded && (
          <span className="muted" style={{ fontSize: 9 }}>
            ({node.calls!.length} calls)
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && expanded && node.calls!.map((child, i) => (
        <TraceNode key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

// ── Input tab decoded params ──────────────────────────────────────────────

function InputCalldataSection({ input, selector }: { input: string; selector: string }) {
  const sig = useResolvedSelectorSignature(selector)
  const decoded = decodeCallWithFallback(input, selector, sig)

  const hasDecoded = decoded && decoded.params.length > 0
  const byteLen = Math.floor((input.length - 2) / 2)
  const words = input.slice(10).match(/.{1,64}/g) ?? []

  return (
    <>
      {hasDecoded && (
        <div style={{
          marginBottom: 10, background: 'var(--surface2)',
          border: '1px solid var(--border)', borderRadius: 2, padding: '6px 10px',
        }}>
          {decoded.params.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 3 }}>
              <span style={{ color: 'var(--text3)', fontSize: 9, flexShrink: 0, paddingTop: 1, minWidth: 80 }}>{p.name}</span>
              <DecodedValueDisplay value={p.value} type={p.type} />
            </div>
          ))}
        </div>
      )}
      <RawCalldataView
        input={input}
        byteLen={byteLen}
        words={words}
        openByDefault={!hasDecoded && byteLen <= 100}
      />
    </>
  )
}

// ── Tx navigation controls ────────────────────────────────────────────────

function TxNav({ txHash, blockNumber }: { txHash: string; blockNumber: number }) {
  const { blocks, goto, nav } = useStore()
  const block = blocks.get(blockNumber)
  if (!block) return null

  const idx  = block.transactions.findIndex((t) => t.hash === txHash)
  const prev = idx > 0 ? block.transactions[idx - 1] : null
  const next = idx < block.transactions.length - 1 ? block.transactions[idx + 1] : null

  return (
    <div className="nav-controls">
      <button
        className="nav-btn"
        disabled={!prev}
        onClick={() => prev && goto(carryBlockFilters(nav, { view: 'tx', txHash: prev.hash, blockNumber }))}
      >← prev tx</button>

      <div className="nav-label">
        Tx <strong style={{ color: 'var(--accent)' }}>{idx + 1}</strong>
        <span className="muted"> / {block.transactions.length}</span>
        <span className="muted"> in </span>
        <button
          style={{ color: 'var(--accent)', fontSize: 11, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
          onClick={() => goto(carryBlockFilters(nav, { view: 'block', blockNumber }))}
        >
          #{blockNumber.toLocaleString()}
        </button>
      </div>

      <button
        className="nav-btn"
        disabled={!next}
        onClick={() => next && goto(carryBlockFilters(nav, { view: 'tx', txHash: next.hash, blockNumber }))}
      >next tx →</button>
    </div>
  )
}

// ── Tx metadata header ────────────────────────────────────────────────────

function TxMeta({ txHash, blockNumber }: { txHash: string; blockNumber: number }) {
  const { blocks } = useStore()
  const block = blocks.get(blockNumber)
  const tx = block?.transactions.find((t) => t.hash === txHash)
  if (!tx) return null

  const toProto = tx.to ? KNOWN_PROTOCOLS[tx.to] : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Hash */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        <span className="muted" style={{ fontSize: 10 }}>HASH</span>
        <HexTag value={tx.hash} type="hash" muted />
      </div>

      {/* From / To grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        borderBottom: '1px solid var(--border)',
      }}>
        {[
          { label: 'From', content: <HexTag value={tx.from} type="address" /> },
          {
            label: 'To',
            content: tx.to
              ? <><HexTag value={tx.to} type="address" />{toProto && <span className="badge muted">{toProto.name}</span>}</>
              : <span className="badge muted">contract deploy</span>,
          },
        ].map(({ label, content }) => (
          <div key={label} style={{ padding: '6px 12px', borderRight: '1px solid var(--border)' }}>
            <div className="stat-label">{label}</div>
            <div className="flex-center gap4" style={{ marginTop: 2 }}>{content}</div>
          </div>
        ))}
      </div>

      {/* Stats row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        borderBottom: '1px solid var(--border)',
      }}>
        {[
          { label: 'Value',   value: tx.value > 0n ? `${formatEth(tx.value, 6)} ETH` : '—' },
          { label: 'Method',  value: tx.methodSelector ?? '—' },
          { label: 'Logs',    value: formatNumber(tx.logs.length) },
          { label: 'Tokens',  value: formatNumber(tx.tokenFlows.length) },
        ].map(({ label, value }) => (
          <div key={label} style={{ padding: '6px 12px', borderRight: '1px solid var(--border)' }}>
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ fontSize: 11 }}>
              {label === 'Method' ? <SelectorTag selector={value === '—' ? null : value} inputHex={tx.input} /> : value}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main tx view ──────────────────────────────────────────────────────────

type TxTab = 'flows' | 'trace' | 'logs' | 'input'

export function TxView({ txHash, blockNumber }: { txHash: string; blockNumber: number }) {
  const { blocks, traces, traceLoading, traceError, fetchTrace } = useStore()
  const [tab, setTab] = useState<TxTab>('flows')

  const block = blocks.get(blockNumber)
  const tx    = block?.transactions.find((t) => t.hash === txHash)
  const trace = traces.get(txHash)
  const loading  = traceLoading.has(txHash)
  const traceErr = traceError.get(txHash)

  useEffect(() => {
    if (tab === 'trace' && !trace && !loading && !traceErr) {
      fetchTrace(txHash)
    }
  }, [tab, txHash])

  if (!tx) {
    return (
      <div className="empty-state">
        Transaction not found in loaded blocks.
      </div>
    )
  }

  const allFlows = [...tx.tokenFlows]
  const allEthFlows = [...tx.ethFlows]

  return (
    <div className="tx-layout">
      {/* Left: tx info */}
      <div style={{
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <TxNav txHash={txHash} blockNumber={blockNumber} />
        <TxMeta txHash={txHash} blockNumber={blockNumber} />

        {/* Tab bar */}
        <div style={{
          display: 'flex', gap: 2, padding: '4px 8px',
          borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          {(['flows', 'trace', 'logs', 'input'] as TxTab[]).map((t) => (
            <button
              key={t}
              className={`topbar-btn ${tab === t ? 'active' : ''}`}
              style={{ fontSize: 10, padding: '2px 8px', textTransform: 'capitalize' }}
              onClick={() => setTab(t)}
            >
              {t}
              {t === 'logs'  && ` (${tx.logs.length})`}
              {t === 'flows' && ` (${tx.tokenFlows.length + tx.ethFlows.length})`}
            </button>
          ))}
        </div>

        <div className="scroll-y" style={{ flex: 1 }}>
          {tab === 'flows' && (
            <>
              {/* Protocol events */}
              {tx.protocols.length > 0 && (
                <section>
                  <div className="panel-header">Protocol Activity</div>
                  <ProtocolEventList events={tx.protocols} tokenFlows={tx.tokenFlows} />
                </section>
              )}

              {/* ETH flows */}
              {tx.ethFlows.length > 0 && (
                <section>
                  <div className="panel-header">ETH Flows</div>
                  <EthFlowList flows={tx.ethFlows} />
                </section>
              )}

              {/* Token flows */}
              {tx.tokenFlows.length > 0 && (
                <section>
                  <div className="panel-header">Token Flows ({tx.tokenFlows.length})</div>
                  <TokenFlowList flows={tx.tokenFlows} />
                </section>
              )}

              {/* Net summary */}
              {(tx.tokenFlows.length > 0 || tx.ethFlows.length > 0) && (
                <section>
                  <div className="panel-header">Net Flows (per address)</div>
                  <NetFlowSummary tokenFlows={tx.tokenFlows} ethFlows={tx.ethFlows} />
                </section>
              )}

              {tx.protocols.length === 0 && tx.tokenFlows.length === 0 && tx.ethFlows.length === 0 && (
                <div className="empty-state">No token or ETH flows detected in logs</div>
              )}
            </>
          )}

          {tab === 'logs' && (
            <CollapsibleList
              items={tx.logs}
              pageSize={8}
              defaultMode="full"
              label="logs"
              emptyMessage="No logs"
              renderItem={(log, i) => (
                <div key={i} className="log-row">
                  <div className="flex-center gap4" style={{ flexWrap: 'wrap', marginBottom: 2 }}>
                    <span className="muted" style={{ fontSize: 9 }}>#{log.logIndex}</span>
                    <HexTag value={log.address} type="address" />
                    {log.topics[0] && <TopicTag topic={log.topics[0]} />}
                  </div>
                  <DecodedLogView log={log} />
                </div>
              )}
            />
          )}

          {tab === 'input' && (
            <div style={{ padding: '10px 12px' }}>
              {(!tx.input || tx.input === '0x') ? (
                <div className="empty-state">No input data</div>
              ) : (
                <>
                  {tx.methodSelector && (
                    <div style={{ marginBottom: 8, fontSize: 11, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <SelectorTag selector={tx.methodSelector} inputHex={tx.input} />
                      <span className="muted" style={{ fontSize: 9 }}>{tx.input.length / 2 - 2} bytes</span>
                    </div>
                  )}
                  {tx.methodSelector && (
                    <InputCalldataSection key={tx.hash} input={tx.input} selector={tx.methodSelector} />
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'trace' && (
            <div style={{ padding: '8px 12px' }}>
              {loading && (
                <div className="empty-state">
                  Loading trace…
                  <div className="shimmer" style={{ width: 200, margin: '12px auto' }} />
                </div>
              )}
              {traceErr && (
                <div className="config-error" style={{ margin: 8 }}>
                  Trace error: {traceErr}<br />
                  <span className="muted" style={{ fontSize: 10 }}>
                    Make sure your RPC supports debug_traceTransaction (Alchemy, QuickNode, etc.)
                  </span>
                </div>
              )}
              {!loading && !traceErr && !trace && (
                <div className="empty-state">
                  <button
                    className="config-btn"
                    style={{ width: 'auto', padding: '8px 20px' }}
                    onClick={() => fetchTrace(txHash)}
                  >
                    Load Trace
                  </button>
                </div>
              )}
              {trace && <TraceNode node={trace} depth={0} />}
            </div>
          )}
        </div>
      </div>

      {/* Right: summary / context */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="panel-header" style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>
          Transaction Context
        </div>
        <div className="scroll-y" style={{ flex: 1, padding: '8px 0' }}>
          {/* Quick stats */}
          <div style={{ padding: '0 12px 12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { label: 'Protocol Events', value: tx.protocols.length },
                { label: 'Token Transfers', value: tx.tokenFlows.length },
                { label: 'ETH Movements',   value: tx.ethFlows.length },
                { label: 'Event Logs',      value: tx.logs.length },
              ].map(({ label, value }) => (
                <div key={label} style={{
                  background: 'var(--surface2)', padding: '8px 10px',
                  borderRadius: 2, border: '1px solid var(--border)',
                }}>
                  <div className="stat-label">{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: value > 0 ? 'var(--accent)' : 'var(--text3)' }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Decoded call */}
          {tx.input && tx.input !== '0x' && tx.methodSelector && (
            <section>
              <div className="panel-header">Call</div>
              <DecodedCallView key={tx.hash} input={tx.input} selector={tx.methodSelector} />
            </section>
          )}

          {/* Protocol events quick list */}
          {tx.protocols.length > 0 && (
            <section>
              <div className="panel-header">Activity Summary</div>
              <ProtocolEventList events={tx.protocols} />
            </section>
          )}

          {/* Tokens involved */}
          {tx.tokenFlows.length > 0 && (
            <section>
              <div className="panel-header">Tokens Involved</div>
              <div style={{ padding: '6px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[...new Set(tx.tokenFlows.map((f) => f.token))].map((token) => {
                  const info = KNOWN_TOKENS[token]
                  return info ? (
                    <span
                      key={token}
                      className="badge"
                      style={{ background: `${info.color}22`, color: info.color, border: `1px solid ${info.color}44` }}
                    >
                      {info.symbol}
                    </span>
                  ) : (
                    <HexTag key={token} value={token} type="address" />
                  )
                })}
              </div>
            </section>
          )}

          {/* Net flow summary */}
          {(tx.tokenFlows.length > 0 || tx.ethFlows.length > 0) && (
            <section>
              <div className="panel-header">Net Flows</div>
              <NetFlowSummary tokenFlows={tx.tokenFlows} ethFlows={tx.ethFlows} />
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
