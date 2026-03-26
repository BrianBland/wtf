import { Block } from '../types'

export interface AddrTokenFlow {
  address: string
  amountIn:  bigint   // sent TO pool
  amountOut: bigint   // received FROM pool
}

export interface PoolFlows {
  pool:   string
  token0: string
  token1: string

  // Per-address flows for each token
  token0Flows: Map<string, AddrTokenFlow>
  token1Flows: Map<string, AddrTokenFlow>

  // Totals
  token0TotalIn:  bigint
  token0TotalOut: bigint
  token1TotalIn:  bigint
  token1TotalOut: bigint
}

function ensureFlow(map: Map<string, AddrTokenFlow>, addr: string): AddrTokenFlow {
  if (!map.has(addr)) map.set(addr, { address: addr, amountIn: 0n, amountOut: 0n })
  return map.get(addr)!
}

/** Compute directional token flows through a specific pool address across blocks. */
export function computePoolFlows(blocks: Block[], poolAddr: string, token0: string, token1: string): PoolFlows {
  const pool = poolAddr.toLowerCase()
  const t0   = token0.toLowerCase()
  const t1   = token1.toLowerCase()

  const token0Flows = new Map<string, AddrTokenFlow>()
  const token1Flows = new Map<string, AddrTokenFlow>()

  let token0TotalIn  = 0n
  let token0TotalOut = 0n
  let token1TotalIn  = 0n
  let token1TotalOut = 0n

  for (const block of blocks) {
    for (const tx of block.transactions) {
      // Only consider txs that touch this pool
      const touchesPool = tx.tokenFlows.some(
        (f) => f.from === pool || f.to === pool
      )
      if (!touchesPool) continue

      for (const flow of tx.tokenFlows) {
        if (flow.token !== t0 && flow.token !== t1) continue
        const isToken0 = flow.token === t0
        const flowMap  = isToken0 ? token0Flows : token1Flows

        if (flow.to === pool) {
          // Address sending token INTO pool
          const counterparty = flow.from
          if (counterparty === pool) continue
          const entry = ensureFlow(flowMap, counterparty)
          entry.amountIn += flow.amount
          if (isToken0) token0TotalIn += flow.amount
          else          token1TotalIn += flow.amount
        } else if (flow.from === pool) {
          // Pool sending token OUT to address
          const counterparty = flow.to
          if (counterparty === pool) continue
          const entry = ensureFlow(flowMap, counterparty)
          entry.amountOut += flow.amount
          if (isToken0) token0TotalOut += flow.amount
          else          token1TotalOut += flow.amount
        }
      }
    }
  }

  return {
    pool, token0: t0, token1: t1,
    token0Flows, token1Flows,
    token0TotalIn, token0TotalOut,
    token1TotalIn, token1TotalOut,
  }
}

/** Sort and take top N addresses by total flow volume for a token */
export function topFlows(flowMap: Map<string, AddrTokenFlow>, n: number): AddrTokenFlow[] {
  return [...flowMap.values()]
    .sort((a, b) => Number((b.amountIn + b.amountOut) - (a.amountIn + a.amountOut)))
    .slice(0, n)
}
