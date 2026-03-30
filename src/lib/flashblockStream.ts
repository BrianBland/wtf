import { FlashblockChunk, LiveFlashblockState } from '../types'

/** Shape of the result inside an eth_subscription newFlashblocks notification. */
interface FlashblockResult {
  index:       number
  payload_id:  string
  base?: {
    blockNumber: string   // hex, only on index 0
    gasLimit:    string   // hex, only on index 0
    [k: string]: unknown
  }
  diff: {
    gasUsed:      string   // hex, CUMULATIVE total gas for the block so far
    transactions: string[] // INCREMENTAL: only new txs in this flashblock
    [k: string]: unknown
  }
  metadata?: {
    block_number: number   // decimal
    [k: string]: unknown
  }
}

/**
 * Create a stateful handler for newFlashblocks subscription results.
 * Pass the returned function to client.subscribe('newFlashblocks', ...).
 */
export function makeFlashblockHandler(
  onUpdate: (state: LiveFlashblockState) => void,
): (result: unknown) => void {
  let lastBlockNumber: number | null = null
  let lastPayloadId:   string | null = null
  let lastGasLimit:    bigint        = 30_000_000n
  let prevGasUsed:     bigint        = 0n
  let prevTxCount:     number        = 0
  let chunks: FlashblockChunk[] = []

  return function handleResult(rawResult: unknown) {
    const data = rawResult as FlashblockResult
    try {
      const blockNumber = data.metadata?.block_number
        ?? (data.base ? parseInt(data.base.blockNumber, 16) : null)
      if (blockNumber === null || !Number.isFinite(blockNumber)) return

      if (data.base?.gasLimit) lastGasLimit = BigInt(data.base.gasLimit)

      const totalGasUsed = BigInt(data.diff.gasUsed)
      const chunkTxCount = data.diff.transactions.length

      if (blockNumber !== lastBlockNumber || data.payload_id !== lastPayloadId) {
        lastBlockNumber = blockNumber
        lastPayloadId   = data.payload_id
        prevGasUsed     = 0n
        prevTxCount     = 0
        chunks          = []
      }

      const chunkGasUsed = totalGasUsed - prevGasUsed
      prevGasUsed  = totalGasUsed
      prevTxCount += chunkTxCount

      const updated: FlashblockChunk = { index: data.index, txCount: chunkTxCount, gasUsed: chunkGasUsed }
      chunks = data.index < chunks.length
        ? [...chunks.slice(0, data.index), updated, ...chunks.slice(data.index + 1)]
        : [...chunks, updated]

      onUpdate({
        blockNumber,
        payloadId:    data.payload_id,
        chunks,
        totalGasUsed,
        totalTxCount: prevTxCount,
        gasLimit:     lastGasLimit,
      })
    } catch (e) {
      console.warn('[flashblocks] processing error:', e)
    }
  }
}
