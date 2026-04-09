import { TokenFlow, EthFlow, ProtocolEvent } from '../types'
import { KNOWN_TOKENS, PROTOCOL_COLORS } from '../lib/protocols'
import { ACTION_COLORS } from '../lib/colorize'
import { formatAmount, formatEth, shortAddr } from '../lib/formatters'
import { HexTag, TokenBadge } from './HexTag'
import { useStore } from '../store'
import { TokenDetails } from '../lib/tokenFetch'
import { PoolMeta } from '../lib/poolFetch'
import { usePrefetchPoolMetadata, usePrefetchTokenMetadata } from '../hooks/usePrefetchMetadata'

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

// ── ERC-20 token transfer list ────────────────────────────────────────────

export function TokenFlowList({ flows }: { flows: TokenFlow[] }) {
  const { tokenCache, poolCache } = useStore()
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

export function ProtocolEventList({ events, tokenFlows }: { events: ProtocolEvent[]; tokenFlows?: TokenFlow[] }) {
  usePrefetchPoolMetadata(
    events.map((ev) => {
      const pool = ev.extra?.pool as string | undefined
      return pool && pool.length !== 66 ? pool : null
    })
  )
  usePrefetchTokenMetadata(
    events.flatMap((ev) => (
      ev.protocol === 'Uniswap V4' && ev.action === 'Swap'
        ? [ev.extra?.tokenIn as string | undefined, ev.extra?.tokenOut as string | undefined]
        : []
    ))
  )

  const { tokenCache, poolCache } = useStore()

  if (events.length === 0) return null

  return (
    <div className="flow-table" style={{ gap: 4 }}>
      {events.map((ev, i) => {
        const color      = ACTION_COLORS[ev.action]   ?? 'var(--text2)'
        const protoColor = PROTOCOL_COLORS[ev.protocol] ?? 'var(--text2)'
        const token  = ev.token  ? resolveToken(ev.token,  tokenCache) : null
        const token2 = ev.token2 ? resolveToken(ev.token2, tokenCache) : null

        // Resolve pool metadata for pool-based events (swaps and LP)
        const poolAddr = ev.extra?.pool ? (ev.extra.pool as string).toLowerCase() : null
        const poolEntry = poolAddr ? poolCache.get(poolAddr) : undefined
        const poolMeta = typeof poolEntry === 'object' ? poolEntry as PoolMeta : null
        const tok0 = poolMeta ? resolveToken(poolMeta.token0, tokenCache) : null
        const tok1 = poolMeta ? resolveToken(poolMeta.token1, tokenCache) : null

        // Swap details: derive in/out from pool token pair + amounts
        const isSwap = ev.action === 'Swap'
        let swapIn:  { tok: ReturnType<typeof resolveToken>; amt: bigint } | null = null
        let swapOut: { tok: ReturnType<typeof resolveToken>; amt: bigint } | null = null
        if (isSwap && poolMeta) {
          const a0str = ev.extra?.amount0 as string | undefined
          const a1str = ev.extra?.amount1 as string | undefined
          if (a0str !== undefined && a1str !== undefined) {
            // V3-style: signed int256 — positive = into pool (user sold), negative = out of pool (user received)
            const a0 = BigInt(a0str), a1 = BigInt(a1str)
            if (a0 > 0n) { swapIn = { tok: tok0, amt: a0 };  swapOut = { tok: tok1, amt: -a1 } }
            else          { swapIn = { tok: tok1, amt: a1 };  swapOut = { tok: tok0, amt: -a0 } }
          } else {
            // V2-style: separate in/out slots
            const a0In  = BigInt((ev.extra?.amount0In  as string | undefined) ?? '0')
            const a1In  = BigInt((ev.extra?.amount1In  as string | undefined) ?? '0')
            const a0Out = BigInt((ev.extra?.amount0Out as string | undefined) ?? '0')
            const a1Out = BigInt((ev.extra?.amount1Out as string | undefined) ?? '0')
            if (a0In > 0n) { swapIn = { tok: tok0, amt: a0In };  swapOut = { tok: tok1, amt: a1Out } }
            else            { swapIn = { tok: tok1, amt: a1In };  swapOut = { tok: tok0, amt: a0Out } }
          }
        }

        // V4: tokens annotated at store level in extra.tokenIn/Out/amountIn/Out
        if (isSwap && !swapIn && ev.protocol === 'Uniswap V4') {
          const tiAddr = ev.extra?.tokenIn  as string | undefined
          const toAddr = ev.extra?.tokenOut as string | undefined
          const aiStr  = ev.extra?.amountIn  as string | undefined
          const aoStr  = ev.extra?.amountOut as string | undefined
          if (tiAddr && aiStr) {
            const tok = resolveToken(tiAddr, tokenCache)
            if (tok) swapIn = { tok, amt: BigInt(aiStr) }
          }
          if (toAddr && aoStr) {
            const tok = resolveToken(toAddr, tokenCache)
            if (tok) swapOut = { tok, amt: BigInt(aoStr) }
          }
        }

        // LP / fee-collection details: amount0/amount1 in extra, mapped to pool tokens
        const isLp = ev.action === 'AddLiquidity' || ev.action === 'RemoveLiquidity' || ev.action === 'CollectFees'
        const lpAmount0 = ev.extra?.amount0 ? BigInt(ev.extra.amount0 as string) : undefined
        const lpAmount1 = ev.extra?.amount1 ? BigInt(ev.extra.amount1 as string) : undefined

        return (
          <div key={i} className="flex-center gap4 flow-row" style={{ flexWrap: 'wrap' }}>
            <span
              className="badge"
              style={{ background: `${protoColor}18`, color: protoColor, border: `1px solid ${protoColor}33` }}
            >
              {ev.protocol}
            </span>
            <span style={{ fontWeight: 600, color }}>{ev.action}</span>

            {/* Single-token events (Aave, Morpho, etc.) */}
            {ev.amount !== undefined && token && (
              <span className="flow-amount" style={{ color }}>
                {formatAmount(ev.amount, token.decimals, 4)} {token.symbol}
              </span>
            )}
            {ev.amount !== undefined && !token && ev.token && (
              <span className="flow-amount" style={{ color }}>
                {ev.amount.toString()} <HexTag value={ev.token} type="address" />
              </span>
            )}

            {/* Two-token events with ev.token2 (Balancer swap, Aave liquidation) */}
            {ev.token2 && (
              <>
                <span className="muted">{isSwap ? '→' : '↔'}</span>
                {token2
                  ? <span className="flow-amount" style={{ color }}>
                      {ev.amount2 !== undefined ? `${formatAmount(ev.amount2, token2.decimals, 4)} ` : ''}{token2.symbol}
                    </span>
                  : <HexTag value={ev.token2} type="address" />
                }
              </>
            )}

            {/* Pool-based swap details (V2/V3 AMMs) */}
            {isSwap && swapIn && swapOut && swapIn.tok && swapOut.tok && (
              <>
                <span className="flow-amount" style={{ color }}>
                  {formatAmount(swapIn.amt, swapIn.tok.decimals, 4)} {swapIn.tok.symbol}
                </span>
                <span className="muted">→</span>
                <span className="flow-amount" style={{ color }}>
                  {formatAmount(swapOut.amt, swapOut.tok.decimals, 4)} {swapOut.tok.symbol}
                </span>
              </>
            )}

            {/* LP / CollectFees event details */}
            {isLp && lpAmount0 !== undefined && lpAmount1 !== undefined && (lpAmount0 > 0n || lpAmount1 > 0n) && (
              <>
                {lpAmount0 > 0n && (
                  tok0
                    ? <span className="flow-amount" style={{ color }}>{formatAmount(lpAmount0, tok0.decimals, 4)} {tok0.symbol}</span>
                    : <span className="flow-amount" style={{ color }}>{lpAmount0.toString()} {poolMeta && <HexTag value={poolMeta.token0} type="address" muted />}</span>
                )}
                {lpAmount0 > 0n && lpAmount1 > 0n && <span className="muted">+</span>}
                {lpAmount1 > 0n && (
                  tok1
                    ? <span className="flow-amount" style={{ color }}>{formatAmount(lpAmount1, tok1.decimals, 4)} {tok1.symbol}</span>
                    : <span className="flow-amount" style={{ color }}>{lpAmount1.toString()} {poolMeta && <HexTag value={poolMeta.token1} type="address" muted />}</span>
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
