import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shelfRows } from '../src/lib/blockShelf'
import { Block } from '../src/types'

test('shelf rows are aligned to 150-block boundaries, newest first', () => {
  const blocks = [149, 150, 151, 299, 300].map((number) => ({ number }) as Block)
  const rows = shelfRows(blocks)
  assert.deepEqual(rows.map(([row, byNumber]) => [row, [...byNumber.keys()]]), [
    [2, [300]],
    [1, [150, 151, 299]],
    [0, [149]],
  ])
})
