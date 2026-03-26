import { TokenFlow, EthFlow, ProtocolEvent } from '../types'
import { KNOWN_TOKENS } from '../lib/protocols'
import { ACTION_COLORS } from '../lib/colorize'
import { formatAmount, formatEth, shortAddr } from '../lib/formatters'
import { HexTag, TokenBadge } from './HexTag'
import { useStore } from '../store'
import { TokenDetails } from '../lib/tokenFetch'

type ResolvedToken = { symbol: string; decimals: number; color?: string }

function resolveToken(
  address: string,
  cache: Map<string, TokenDetails | 'loading' | 'error'>,
): ResolvedToken | null {
  const s = KNOWN_TOKENS[address]
  if (s) return s
  const entry = cache.get(address)
  if (entry && typeof entry === 'object') return entry
  return null
}

// ── Net flow computation ──────────────────────────────────────────────────

interface NetEntry {
  address: string
  netIn: bigint
  netOut: bigint
}

function computeNetFlows(flows: TokenFlow[], token: string): NetEntry[] {
  const totals = new Map<string, { in: bigint; out: bigint }>()

  for (const f of flows) {
    if (f.token !== token) continue
    if (!totals.has(f.to)) totals.set(f.to, { in: 0n, out: 0n })
    if (!totals.has(f.from)) totals.set(f.from, { in: 0n, out: 0n })
    totals.get(f.to)!.in  += f.amount
    totals.get(f.from)!.out += f.amount
  }

  return [...totals.entries()].map(([address, v]) => ({
    address,
    netIn:  v.in,
    netOut: v.out,
  })).sort((a, b) => Number(b.netIn - b.netOut) - Number(a.netIn - a.netOut))
}

// ── ERC-20 token transfer list ────────────────────────────────────────────

export function TokenFlowList({ flows }: { flows: TokenFlow[] }) {
  const { tokenCache } = useStore()
  if (flows.length === 0) return null

  const byToken = new Map<string, TokenFlow[]>()
  for (const f of flows) {
    if (!byToken.has(f.token)) byToken.set(f.token, [])
    byToken.get(f.token)!.push(f)
  }

  return (
    <div className="flow-table">
      {[...byToken.entries()].map(([token, tflows]) => {
        const info    = resolveToken(token, tokenCache)
        const totalIn = tflows.reduce((s, f) => s + f.amount, 0n)

        return (
          <div key={token} style={{ marginBottom: 6 }}>
            <div className="flex-center gap4" style={{ marginBottom: 4 }}>
              <TokenBadge address={token} />
              <span className="muted" style={{ fontSize: 10 }}>
                {tflows.length} transfer{tflows.length > 1 ? 's' : ''}
                {' · '}total: {info ? formatAmount(totalIn, info.decimals, 4) : totalIn.toString()}
              </span>
            </div>
            {tflows.map((f, i) => (
              <div key={i} className="flow-row" style={{ paddingLeft: 8 }}>
                <HexTag value={f.from} type="address" />
                <span className="flow-arrow">→</span>
                <HexTag value={f.to} type="address" />
                <span className="flow-amount flow-in">
                  +{info ? formatAmount(f.amount, info.decimals, 4) : f.amount.toString()}
                  {' '}{info?.symbol ?? shortAddr(token)}
                </span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ── ETH flow ─────────────────────────────────────────────────────────────

export function EthFlowList({ flows }: { flows: EthFlow[] }) {
  if (flows.length === 0) return null

  return (
    <div className="flow-table">
      {flows.map((f, i) => (
        <div key={i} className="flow-row">
          <HexTag value={f.from} type="address" />
          <span className="flow-arrow">→</span>
          <HexTag value={f.to} type="address" />
          <span className="flow-amount flow-in" style={{ color: 'var(--amber)' }}>
            +{formatEth(f.value, 6)} ETH
          </span>
          {f.type === 'internal' && (
            <span className="badge muted" style={{ fontSize: 9 }}>internal</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Protocol event pills ──────────────────────────────────────────────────

export function ProtocolEventList({ events }: { events: ProtocolEvent[] }) {
  const { tokenCache } = useStore()
  if (events.length === 0) return null

  return (
    <div className="flow-table" style={{ gap: 4 }}>
      {events.map((ev, i) => {
        const color  = ACTION_COLORS[ev.action] ?? 'var(--text2)'
        const token  = ev.token  ? resolveToken(ev.token,  tokenCache) : null
        const token2 = ev.token2 ? resolveToken(ev.token2, tokenCache) : null

        return (
          <div key={i} className="flex-center gap4 flow-row" style={{ flexWrap: 'wrap' }}>
            <span
              className="badge"
              style={{ background: `${color}18`, color, border: `1px solid ${color}33` }}
            >
              {ev.protocol}
            </span>
            <span style={{ fontWeight: 600, color }}>{ev.action}</span>

            {ev.amount !== undefined && token && (
              <span className="flow-amount" style={{ color }}>
                {formatAmount(ev.amount, token.decimals, 4)} {token.symbol}
              </span>
            )}
            {ev.amount !== undefined && !token && ev.token && (
              <span className="flow-amount" style={{ color }}>
                {ev.amount.toString()}
                {' '}
                <HexTag value={ev.token} type="address" />
              </span>
            )}

            {ev.token2 && (
              <>
                <span className="muted">↔</span>
                {token2
                  ? <span className="badge" style={{ background: `${token2.color}22`, color: token2.color }}>{token2.symbol}</span>
                  : <HexTag value={ev.token2} type="address" />
                }
                {ev.amount2 !== undefined && token2 && (
                  <span className="flow-amount" style={{ color }}>
                    {formatAmount(ev.amount2, token2.decimals, 4)} {token2.symbol}
                  </span>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Net flow summary table (per-address totals) ───────────────────────────

export function NetFlowSummary({ tokenFlows, ethFlows }: { tokenFlows: TokenFlow[]; ethFlows: EthFlow[] }) {
  const { tokenCache } = useStore()
  type Balance = { in: bigint; out: bigint }
  const balances = new Map<string, Map<string, Balance>>()

  const ensure = (addr: string, token: string) => {
    if (!balances.has(addr)) balances.set(addr, new Map())
    if (!balances.get(addr)!.has(token)) balances.get(addr)!.set(token, { in: 0n, out: 0n })
    return balances.get(addr)!.get(token)!
  }

  for (const f of tokenFlows) {
    ensure(f.to,   f.token).in  += f.amount
    ensure(f.from, f.token).out += f.amount
  }
  for (const f of ethFlows) {
    ensure(f.to,   '0x').in  += f.value
    ensure(f.from, '0x').out += f.value
  }

  if (balances.size === 0) return null

  return (
    <div className="flow-table">
      {[...balances.entries()].map(([addr, tokens]) => (
        <div key={addr} style={{ marginBottom: 4 }}>
          <div className="flex-center gap4" style={{ marginBottom: 2 }}>
            <HexTag value={addr} type="address" />
          </div>
          {[...tokens.entries()].map(([token, bal]) => {
            const info = token === '0x' ? null : resolveToken(token, tokenCache)
            const sym  = token === '0x' ? 'ETH' : (info?.symbol ?? shortAddr(token))
            const dec  = token === '0x' ? 18 : (info?.decimals ?? 18)
            const net  = bal.in - bal.out

            return (
              <div key={token} className="flex-center gap8" style={{ paddingLeft: 16, fontSize: 10.5 }}>
                <span className="muted">{sym}</span>
                <span className="flow-in">+{formatAmount(bal.in, dec, 4)}</span>
                <span className="muted">in</span>
                <span className="flow-out">-{formatAmount(bal.out, dec, 4)}</span>
                <span className="muted">out</span>
                <span style={{ color: net >= 0n ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                  net: {net >= 0n ? '+' : ''}{formatAmount(net, dec, 4)}
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
