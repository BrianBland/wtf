import { Block, ProtocolEvent } from '../types'
import { USDC_ADDRESS, WETH_ADDRESS, USDT_ADDRESS } from './protocols'
import { isV4PoolId } from './v4PoolKey'

export type VolumeStatus = 'complete' | 'unresolved' | 'unavailable'

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
  volumeStatus:   VolumeStatus
}

interface SwapVolume {
  usdc: bigint
  weth: bigint
}

const STABLES = new Set([USDC_ADDRESS, USDT_ADDRESS])
const UINT256_MAX = (1n << 256n) - 1n
const INT256_MIN = -(1n << 255n)
const INT256_MAX = (1n << 255n) - 1n

function parseInteger(value: unknown, signed: boolean): bigint | null {
  if (typeof value !== 'string') return null
  const pattern = signed ? /^-?(?:0|[1-9][0-9]*)$/ : /^(?:0|[1-9][0-9]*)$/
  if (!pattern.test(value) || value === '-0') return null
  const parsed = BigInt(value)
  if (signed && (parsed < INT256_MIN || parsed > INT256_MAX)) return null
  if (!signed && parsed > UINT256_MAX) return null
  return parsed
}

function parseTokens(extra: Record<string, unknown>): [string, string] | null {
  if (typeof extra.token0 !== 'string' || typeof extra.token1 !== 'string') return null
  const token0 = extra.token0.toLowerCase()
  const token1 = extra.token1.toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(token0) || !/^0x[0-9a-f]{40}$/.test(token1)) return null
  if (token0 === '0x' + '0'.repeat(40) || token1 === '0x' + '0'.repeat(40) || token0 === token1) return null
  return [token0, token1]
}

function trackedVolume(
  tokens: [string, string],
  amounts: [bigint, bigint],
  inputIndex: 0 | 1,
): SwapVolume {
  const stable0 = STABLES.has(tokens[0])
  const stable1 = STABLES.has(tokens[1])
  let usdc = 0n
  if (stable0 && stable1) usdc = amounts[inputIndex]
  else if (stable0) usdc = amounts[0]
  else if (stable1) usdc = amounts[1]

  let weth = 0n
  if (tokens[0] === WETH_ADDRESS) weth = amounts[0]
  else if (tokens[1] === WETH_ADDRESS) weth = amounts[1]
  return { usdc, weth }
}

function swapEventVolume(event: ProtocolEvent): SwapVolume | null {
  const extra = event.extra
  if (!extra || extra.volumeDataValid !== true) return null
  const tokens = parseTokens(extra)
  if (!tokens) return null

  if (extra.swapType === 'v3') {
    const amount0 = parseInteger(extra.amount0, true)
    const amount1 = parseInteger(extra.amount1, true)
    if (amount0 === null || amount1 === null) return null
    // Canonical V3 pool deltas have exactly one positive (the pool input) and one negative side.
    if (!((amount0 > 0n && amount1 < 0n) || (amount1 > 0n && amount0 < 0n))) return null
    return trackedVolume(
      tokens,
      [amount0 < 0n ? -amount0 : amount0, amount1 < 0n ? -amount1 : amount1],
      amount0 > 0n ? 0 : 1,
    )
  }

  if (extra.swapType === 'v2') {
    const amount0In = parseInteger(extra.amount0In, false)
    const amount1In = parseInteger(extra.amount1In, false)
    const amount0Out = parseInteger(extra.amount0Out, false)
    const amount1Out = parseInteger(extra.amount1Out, false)
    if (amount0In === null || amount1In === null || amount0Out === null || amount1Out === null) return null

    const input0 = amount0In > 0n
    const input1 = amount1In > 0n
    const output0 = amount0Out > 0n
    const output1 = amount1Out > 0n
    // Ordinary V2/Aerodrome swaps have one input and the opposite output. Ambiguous flash-swap
    // slot combinations are intentionally withheld instead of guessed.
    if (input0 === input1 || output0 === output1 || input0 === output0) return null
    return trackedVolume(
      tokens,
      [input0 ? amount0In : amount0Out, input1 ? amount1In : amount1Out],
      input0 ? 0 : 1,
    )
  }

  return null
}

/** Build a flat pool → activity map across one or more blocks. */
export function buildPoolActivity(blocks: Block[]): Map<string, PoolSummary> {
  const pools = new Map<string, PoolSummary>()

  const getPool = (addr: string): PoolSummary => {
    if (!pools.has(addr)) {
      pools.set(addr, {
        pool: addr, eventProtocols: new Set(), swaps: 0,
        lpAdds: 0, lpRemoves: 0, fees: 0, txHashes: [], usdcVolume: 0n, wethVolume: 0n,
        volumeStatus: isV4PoolId(addr) ? 'unavailable' : 'complete',
      })
    }
    return pools.get(addr)!
  }

  for (const block of blocks) {
    for (const tx of block.transactions) {
      for (const ev of tx.protocols) {
        const rawPool = ev.extra?.pool
        if (typeof rawPool !== 'string') continue
        const addr = rawPool.toLowerCase()
        if (!addr) continue

        const pool = getPool(addr)
        pool.eventProtocols.add(ev.protocol)

        if (!pool.txHashes.includes(tx.hash) && pool.txHashes.length < 200) {
          pool.txHashes.push(tx.hash)
        }

        if (ev.action === 'Swap') {
          pool.swaps++
          if (!isV4PoolId(addr)) {
            const volume = swapEventVolume(ev)
            if (volume) {
              pool.usdcVolume += volume.usdc
              pool.wethVolume += volume.weth
            } else {
              pool.volumeStatus = 'unresolved'
            }
          }
        }
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

  // Generic fallback names used when the factory lookup fails — treat as lowest priority.
  const FALLBACK_PROTOCOLS = new Set(['Uniswap V3', 'Uniswap V2', 'Aerodrome', 'Unknown'])

  for (const pool of pools.values()) {
    // Use factory-resolved protocol if available, else pick the best event protocol.
    // eventProtocols is a Set so all items have count=1 — the old sort was meaningless.
    // Instead, prefer specific protocol names over generic fallbacks like 'Uniswap V3'
    // which are often the result of hint-based guessing rather than factory lookup.
    const protos = [...pool.eventProtocols]
    const eventProtocol =
      protos.find(p => !FALLBACK_PROTOCOLS.has(p)) ??  // prefer specific over generic
      protos[0] ??
      'Unknown'

    const resolved = resolveProtocol(pool.pool) ?? eventProtocol

    if (!groups.has(resolved)) groups.set(resolved, [])
    groups.get(resolved)!.push(pool)
  }

  return groups
}
