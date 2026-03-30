import { Transaction, FlashblockChunk } from '../types'

/**
 * Effective priority fee per gas for a transaction given the block base fee.
 *
 * - EIP-1559 (type 2): maxPriorityFeePerGas (tip cap). The actual effective tip
 *   is min(maxPriorityFeePerGas, maxFeePerGas - baseFee), but we don't store
 *   maxFeePerGas. For nearly all well-formed txs maxFeePerGas >= baseFee +
 *   maxPriorityFeePerGas, so the cap is non-binding and maxPriorityFeePerGas is
 *   the correct bid to use for ordering.
 *
 * - Legacy / type-1: gasPrice - baseFee (clamped to 0). These txs pay gasPrice
 *   per gas; the "priority" portion is what's left after the base fee.
 *
 * - Deposit / system txs: 0 (no gas price fields).
 */
export function effectivePriorityFee(tx: Transaction, baseFee: bigint): bigint {
  if (tx.maxPriorityFeePerGas !== undefined) return tx.maxPriorityFeePerGas
  if (tx.gasPrice !== undefined) {
    return tx.gasPrice > baseFee ? tx.gasPrice - baseFee : 0n
  }
  return 0n
}

/**
 * Detect flashblock boundaries from transaction ordering.
 *
 * Within each flashblock, transactions are ordered by effective priority fee
 * per gas (DESC). A strictly increasing priority fee from tx[i] to tx[i+1]
 * signals a new flashblock boundary.
 * Flashblock 0 typically contains only the system/deposit tx (index 0, fee = 0).
 *
 * Returns a Map from tx hash → flashblock index (0-based).
 */
export function detectFlashblocks(txs: Transaction[], baseFee: bigint): Map<string, number> {
  const sorted = [...txs].sort((a, b) => a.index - b.index)
  const result = new Map<string, number>()
  let fb = 0
  let prevFee: bigint | null = null

  for (const tx of sorted) {
    const fee = effectivePriorityFee(tx, baseFee)
    if (prevFee !== null && fee > prevFee) fb++
    result.set(tx.hash, fb)
    prevFee = fee
  }

  return result
}

/**
 * Build a tx-hash → flashblock-index map from streamed chunk boundaries.
 *
 * Chunks record per-chunk tx counts (NOT cumulative). Transactions are
 * assumed to be in block order (ascending index). Any txs not covered by
 * the chunk list (e.g. appended after the last received flashblock) are
 * assigned to the last chunk's index.
 */
export function flashblockMapFromChunks(
  txs: Transaction[],
  chunks: FlashblockChunk[],
): Map<string, number> {
  const result = new Map<string, number>()
  let txIdx = 0
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.txCount && txIdx < txs.length; i++, txIdx++) {
      result.set(txs[txIdx].hash, chunk.index)
    }
  }
  // Remaining txs (if stream was incomplete) → last chunk's index
  const lastFb = chunks.length > 0 ? chunks[chunks.length - 1].index : 0
  while (txIdx < txs.length) {
    result.set(txs[txIdx].hash, lastFb)
    txIdx++
  }
  return result
}

/** Total number of distinct flashblocks in the map. */
export function flashblockCount(fbMap: Map<string, number>): number {
  if (fbMap.size === 0) return 0
  let max = 0
  for (const v of fbMap.values()) if (v > max) max = v
  return max + 1
}
