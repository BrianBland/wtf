import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { CallTrace } from '../types'
import { HexTag, SelectorTag } from './HexTag'
import { CollapsibleList } from './CollapsibleList'
import { TokenFlowList, EthFlowList, ProtocolEventList, NetFlowSummary } from './ValueFlow'
import { KNOWN_PROTOCOLS, KNOWN_TOKENS } from '../lib/protocols'
import {
  formatEth, formatGas, formatGwei, formatNumber, shortHash, shortAddr,
  hexToBigInt,
} from '../lib/formatters'

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
          <SelectorTag selector={node.input.slice(0, 10).toLowerCase()} />
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

// ── Tx navigation controls ────────────────────────────────────────────────

function TxNav({ txHash, blockNumber }: { txHash: string; blockNumber: number }) {
  const { blocks, goto } = useStore()
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
        onClick={() => prev && goto({ view: 'tx', txHash: prev.hash, blockNumber })}
      >← prev tx</button>

      <div className="nav-label">
        Tx <strong style={{ color: 'var(--accent)' }}>{idx + 1}</strong>
        <span className="muted"> / {block.transactions.length}</span>
        <span className="muted"> in </span>
        <button
          style={{ color: 'var(--accent)', fontSize: 11, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
          onClick={() => goto({ view: 'block', blockNumber })}
        >
          #{blockNumber.toLocaleString()}
        </button>
      </div>

      <button
        className="nav-btn"
        disabled={!next}
        onClick={() => next && goto({ view: 'tx', txHash: next.hash, blockNumber })}
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
              {label === 'Method' ? <SelectorTag selector={value === '—' ? null : value} /> : value}
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
                  <ProtocolEventList events={tx.protocols} />
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
                    {log.topics[0] && (
                      <span className="muted" style={{ fontSize: 9, fontFamily: 'var(--font-mono)' }}>
                        {log.topics[0].slice(0, 10)}…
                      </span>
                    )}
                  </div>
                  {log.topics.map((t, ti) => (
                    <div key={ti} className="log-topic">
                      t[{ti}]: {t}
                    </div>
                  ))}
                  {log.data && log.data !== '0x' && (
                    <div className="log-topic" style={{ wordBreak: 'break-all', marginTop: 2 }}>
                      data: {log.data}
                    </div>
                  )}
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
                    <div style={{ marginBottom: 8, fontSize: 11 }}>
                      Selector: <SelectorTag selector={tx.methodSelector} />
                    </div>
                  )}
                  <div style={{
                    fontSize: 10, color: 'var(--text2)',
                    wordBreak: 'break-all', lineHeight: 1.8,
                    fontFamily: 'var(--font-mono)',
                    background: 'var(--surface2)',
                    padding: '8px 10px',
                    borderRadius: 2,
                    border: '1px solid var(--border)',
                  }}>
                    <span style={{ color: 'var(--purple)' }}>{tx.input.slice(0, 10)}</span>
                    {tx.input.slice(10)}
                  </div>
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
