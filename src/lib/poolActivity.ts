import { Block, TokenFlow } from '../types'
import { USDC_ADDRESS, WETH_ADDRESS } from './protocols'

export interface PoolSummary {
  pool:           string
  eventProtocols: Set<string>   // protocols seen in events (may differ from factory-resolved)
  swaps:          number
  lpAdds:         number
  lpRemoves:      number
  fees:           number
  txHashes:       string[]      // unique, capped at 200
  usdcVolume:     bigint
  wethVolume:     bigint
}

function grossTokenVolume(flows: TokenFlow[], token: string): bigint {
  return flows.reduce((s, f) => f.token === token ? s + f.amount : s, 0n)
}

/** Build a flat pool → activity map across one or more blocks. */
export function buildPoolActivity(blocks: Block[]): Map<string, PoolSummary> {
  const pools = new Map<string, PoolSummary>()

  const getPool = (addr: string): PoolSummary => {
    if (!pools.has(addr)) {
      pools.set(addr, {
        pool: addr, eventProtocols: new Set(), swaps: 0,
        lpAdds: 0, lpRemoves: 0, fees: 0, txHashes: [], usdcVolume: 0n, wethVolume: 0n,
      })
    }
    return pools.get(addr)!
  }

  for (const block of blocks) {
    for (const tx of block.transactions) {
      const usdcVol = grossTokenVolume(tx.tokenFlows, USDC_ADDRESS)
      const wethVol = grossTokenVolume(tx.tokenFlows, WETH_ADDRESS)
      const credited = new Set<string>()

      for (const ev of tx.protocols) {
        const addr = (ev.extra?.pool as string | undefined)?.toLowerCase()
        if (!addr) continue

        const pool = getPool(addr)
        pool.eventProtocols.add(ev.protocol)

        if (!pool.txHashes.includes(tx.hash) && pool.txHashes.length < 200) {
          pool.txHashes.push(tx.hash)
        }

        // Credit volume once per (pool, tx) pair
        if (!credited.has(addr)) {
          credited.add(addr)
          pool.usdcVolume += usdcVol
          pool.wethVolume += wethVol
        }

        if (ev.action === 'Swap')            pool.swaps++
        if (ev.action === 'AddLiquidity')    pool.lpAdds++
        if (ev.action === 'RemoveLiquidity') pool.lpRemoves++
        if (ev.action === 'CollectFees')     pool.fees++
      }
    }
  }

  return pools
}

/** Group the flat pool map by resolved protocol name. */
export function groupByProtocol(
  pools: Map<string, PoolSummary>,
  resolveProtocol: (addr: string) => string | undefined,
): Map<string, PoolSummary[]> {
  const groups = new Map<string, PoolSummary[]>()

  for (const pool of pools.values()) {
    // Use factory-resolved protocol if available, else pick the most common event protocol
    const resolved =
      resolveProtocol(pool.pool) ??
      [...pool.eventProtocols].sort(
        (a, b) =>
          [...pool.eventProtocols].filter((x) => x === b).length -
          [...pool.eventProtocols].filter((x) => x === a).length
      )[0] ??
      'Unknown'

    if (!groups.has(resolved)) groups.set(resolved, [])
    groups.get(resolved)!.push(pool)
  }

  return groups
}
