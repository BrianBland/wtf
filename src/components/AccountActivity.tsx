import { useState } from 'react'
import { Block } from '../types'
import { analyzeBlockAccounts, AccountActivity as AccountActivityData, PatternTag } from '../lib/accountAnalysis'
import { HexTag } from './HexTag'
import { formatAmount, formatEth } from '../lib/formatters'
import { KNOWN_TOKENS } from '../lib/protocols'

const PATTERN_LABELS: Record<PatternTag, { label: string; color: string; title: string }> = {
  'round-trip':      { label: 'round-trip',   color: 'var(--red)',    title: 'Bought and sold the same token — net < 5% of gross' },
  'borrow-repay':    { label: 'borrow↔repay', color: 'var(--amber)',  title: 'Borrowed and repaid the same token' },
  'supply-withdraw': { label: 'supply↔wdraw', color: 'var(--amber)',  title: 'Supplied and withdrew the same token' },
  'add-remove-lp':   { label: 'add↔remove LP',color: 'var(--purple)', title: 'Added and removed liquidity in the same block' },
  'multi-swap':      { label: 'multi-swap',    color: 'var(--accent)', title: '3+ swaps in this block' },
}

function PatternBadge({ tag }: { tag: PatternTag }) {
  const { label, color, title } = PATTERN_LABELS[tag]
  return (
    <span
      className="badge"
      title={title}
      style={{ background: `${color}22`, color, border: `1px solid ${color}44`, fontSize: 9, padding: '1px 5px' }}
    >
      {label}
    </span>
  )
}

function FlowPill({ token, sent, received, net }: { token: string; sent: bigint; received: bigint; net: bigint }) {
  const isEth = token === 'ETH'
  const info  = isEth ? null : KNOWN_TOKENS[token]
  const dec   = info?.decimals ?? 18
  const sym   = isEth ? 'ETH' : (info?.symbol ?? token.slice(2, 7).toUpperCase())

  const fmt = (n: bigint) => isEth ? formatEth(n < 0n ? -n : n, 4) : formatAmount(n < 0n ? -n : n, dec, 4)

  const netColor = net >= 0n ? 'var(--green)' : 'var(--red)'
  const sign     = net >= 0n ? '+' : '-'
  const netAbs   = net < 0n ? -net : net

  return (
    <span
      title={`sent ${fmt(sent)} / received ${fmt(received)}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 2,
        background: 'var(--surface2)', borderRadius: 3,
        padding: '1px 5px', fontSize: 9, color: netColor,
        border: `1px solid ${netColor}44`,
      }}
    >
      <span style={{ opacity: 0.7 }}>{sym}</span>
      <span>{sign}{fmt(netAbs)}</span>
    </span>
  )
}

function AccountRow({ act, onClickTx }: {
  act: AccountActivityData
  onClickTx: (hash: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '4px 10px' }}>
      <div
        className="flex-center gap4"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ fontSize: 10, color: 'var(--text3)', marginRight: 2 }}>{open ? '▼' : '▶'}</span>
        <HexTag value={act.address} type="address" copyable />
        <span className="badge muted" style={{ fontSize: 9 }}>{act.txCount} txs</span>
        <div className="flex-center gap4" style={{ marginLeft: 4, flexWrap: 'wrap' }}>
          {act.patterns.map((p) => <PatternBadge key={p} tag={p} />)}
        </div>
        {act.netFlows.slice(0, 3).map((nf) => (
          <FlowPill key={nf.token} {...nf} />
        ))}
        {act.netFlows.length > 3 && (
          <span style={{ fontSize: 9, color: 'var(--text3)' }}>+{act.netFlows.length - 3} more</span>
        )}
      </div>

      {open && (
        <div style={{ paddingTop: 4, paddingLeft: 20 }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3 }}>Transactions:</div>
          <div className="flex-center gap4" style={{ flexWrap: 'wrap' }}>
            {act.txHashes.map((h) => (
              <span
                key={h}
                className="badge muted"
                style={{ cursor: 'pointer', fontSize: 9 }}
                onClick={(e) => { e.stopPropagation(); onClickTx(h) }}
                title={h}
              >
                {h.slice(0, 10)}…
              </span>
            ))}
          </div>
          {act.netFlows.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6, marginBottom: 3 }}>Net flows:</div>
              <div className="flex-center gap4" style={{ flexWrap: 'wrap' }}>
                {act.netFlows.map((nf) => <FlowPill key={nf.token} {...nf} />)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function AccountActivity({ block, onSelectTx }: {
  block: Block
  onSelectTx: (txHash: string) => void
}) {
  const [collapsed, setCollapsed] = useState(true)
  const [expanded,  setExpanded]  = useState(false)
  const accounts = analyzeBlockAccounts(block)

  if (accounts.length === 0) return null

  return (
    <div style={{ flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
      <div
        className="panel-header"
        style={{ userSelect: 'none' }}
      >
        <span
          style={{ fontSize: 10, color: 'var(--text3)', marginRight: 4, cursor: 'pointer' }}
          onClick={() => setCollapsed((c) => !c)}
        >{collapsed ? '▶' : '▼'}</span>
        <span style={{ cursor: 'pointer' }} onClick={() => setCollapsed((c) => !c)}>
          Cross-tx account patterns
        </span>
        <span className="count">
          {accounts.filter((a) => a.patterns.length > 0).length} flagged · {accounts.length} active
        </span>
        {!collapsed && (
          <button
            className={`topbar-btn ${expanded ? 'active' : ''}`}
            style={{ marginLeft: 'auto', fontSize: 10, padding: '0px 6px', lineHeight: 1.4 }}
            title={expanded ? 'Collapse height' : 'Expand height'}
            onClick={() => setExpanded((e) => !e)}
          >⇕</button>
        )}
      </div>
      {!collapsed && (
        <div style={{ maxHeight: expanded ? '65vh' : 200, overflowY: 'auto' }}>
          {accounts.map((act) => (
            <AccountRow key={act.address} act={act} onClickTx={onSelectTx} />
          ))}
        </div>
      )}
    </div>
  )
}
