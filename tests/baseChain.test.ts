import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  BASE_TIME_ADDRESS, DEPOSITOR_ACCOUNT, L1_BLOCK_ADDRESS,
  blockUtilization, decodeEip1559Params, systemTxLabel,
} from '../src/lib/baseChain'
import { processBlock } from '../src/lib/blockProcessing'
import { totalTxFee } from '../src/lib/txMetrics'
import { RawBlock, RawTransaction } from '../src/types'

// Values observed on Base mainnet after Denim.
const JOVIAN_EXTRA_DATA = '0x01000003e80000000500000000004c4b40'
const BASE_TIME_INPUT = `0x86bdf394${'0'.repeat(61)}0c8` // 200ms
const L1_INFO_INPUT = '0x3db6be2b000008dd00101c12'

function rawTx(index: number, fields: Partial<RawTransaction>): RawTransaction {
  return {
    hash: `0x${index.toString(16).padStart(64, '0')}`,
    blockNumber: '0x1', transactionIndex: `0x${index.toString(16)}`,
    from: `0x${'aa'.repeat(20)}`, to: `0x${'bb'.repeat(20)}`,
    value: '0x0', input: '0x', gas: '0x5208', type: '0x2',
    ...fields,
  }
}

function denimBlock(overrides: Partial<RawBlock> = {}) {
  const raw: RawBlock = {
    number: '0x1', hash: `0x${'11'.repeat(32)}`, parentHash: `0x${'22'.repeat(32)}`,
    timestamp: '0x6a000000', gasUsed: '0xe48d0', gasLimit: '0x2625a00', baseFeePerGas: '0x4c4b40',
    blobGasUsed: '0x4c500', extraData: JOVIAN_EXTRA_DATA, miner: `0x${'00'.repeat(20)}`,
    transactions: [
      rawTx(0, { type: '0x7e', from: DEPOSITOR_ACCOUNT, to: L1_BLOCK_ADDRESS, input: L1_INFO_INPUT }),
      rawTx(1, { type: '0x7e', from: DEPOSITOR_ACCOUNT, to: BASE_TIME_ADDRESS, input: BASE_TIME_INPUT }),
      rawTx(2, { type: '0x7e', from: `0x${'cc'.repeat(20)}` }),
      rawTx(3, {}),
    ],
    ...overrides,
  }
  return processBlock(raw, [], [
    { transactionHash: rawTx(3, {}).hash, gasUsed: '0x5208', effectiveGasPrice: '0x4c4b40', l1Fee: '0x64' },
  ])
}

describe('Denim blocks', () => {
  test('timestamp includes the BaseTime millisecond part', () => {
    const block = denimBlock()
    assert.equal(block.timestampMs, 0x6a000000 * 1000 + 200)
  })

  test('pre-Denim blocks fall back to whole seconds', () => {
    const block = denimBlock({ transactions: [rawTx(0, { type: '0x7e' }), rawTx(1, {})] })
    assert.equal(block.timestampMs, 0x6a000000 * 1000)
  })

  test('labels system and user deposits', () => {
    assert.deepEqual(denimBlock().transactions.map(systemTxLabel), ['L1 info', 'BaseTime .200', 'deposit', null])
  })

  test('decodes Jovian EIP-1559 params and DA footprint', () => {
    const block = denimBlock()
    assert.deepEqual(block.eip1559, { denominator: 1000, elasticity: 5, minBaseFee: 5_000_000n })
    assert.equal(block.daFootprint, 0x4c500n)
  })

  test('utilization uses the larger of gas used and DA footprint', () => {
    assert.equal(blockUtilization({ gasUsed: 10n, gasLimit: 100n, daFootprint: 40n }), 0.4)
    assert.equal(blockUtilization({ gasUsed: 50n, gasLimit: 100n, daFootprint: 40n }), 0.5)
    assert.equal(blockUtilization({ gasUsed: 50n, gasLimit: 100n }), 0.5)
  })

  test('total fee includes the L1 data fee', () => {
    const block = denimBlock()
    assert.equal(totalTxFee(block.transactions[3], block.baseFeePerGas), 0x5208n * 0x4c4b40n + 100n)
  })
})

describe('decodeEip1559Params', () => {
  test('Holocene v0 extraData', () => {
    assert.deepEqual(decodeEip1559Params('0x00000000fa00000006'), { denominator: 250, elasticity: 6 })
  })

  test('rejects non-OP extraData', () => {
    assert.equal(decodeEip1559Params('0x'), undefined)
    assert.equal(decodeEip1559Params('0xd883010d0e846765746888676f312e32312e36856c696e7578'), undefined)
  })

  test('ignores blobGasUsed outside Jovian', () => {
    const block = denimBlock({ extraData: '0x00000000fa00000006' })
    assert.equal(block.daFootprint, undefined)
  })
})

test('histograms skip system deposits but keep user deposits', async () => {
  const { buildHistograms } = await import('../src/lib/aggregations')
  const { senders } = buildHistograms([denimBlock()])
  assert.deepEqual(senders.map((e) => e.key).sort(), [`0x${'aa'.repeat(20)}`, `0x${'cc'.repeat(20)}`])
})
