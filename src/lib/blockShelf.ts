import { Block } from '../types'

/** Blocks per shelf row: 30s of Denim 200ms blocks. Rows are aligned to block numbers so
 *  bars stay put as new blocks arrive; only the newest row grows. */
export const SHELF_ROW_BLOCKS = 150

/** Newest row first; each row maps block number → block. */
export function shelfRows(blocks: Block[]): [number, Map<number, Block>][] {
  const byRow = new Map<number, Map<number, Block>>()
  for (const block of blocks) {
    const row = Math.floor(block.number / SHELF_ROW_BLOCKS)
    if (!byRow.has(row)) byRow.set(row, new Map())
    byRow.get(row)!.set(block.number, block)
  }
  return [...byRow.entries()].sort(([a], [b]) => b - a)
}
