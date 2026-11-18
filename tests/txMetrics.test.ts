import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { processBlock } from '../src/lib/blockProcessing'
import { effectivePriorityFee, findTipRises } from '../src/lib/txMetrics'
import { RawBlock, RawReceipt, RawTransaction, Transaction } from '../src/types'

const BASE_FEE = 5_000_000n
const hex = (n: bigint | number) => `0x${n.toString(16)}`

function rawTx(index: number, fields: Partial<RawTransaction>): RawTransaction {
  return {
    hash: `0x${index.toString(16).padStart(64, '0')}`,
    blockNumber: '0x1',
    transactionIndex: hex(index),
    from: `0x${'aa'.repeat(20)}`,
    to: `0x${'bb'.repeat(20)}`,
    value: '0x0',
    input: '0x',
    gas: '0x5208',
    type: '0x2',
    ...fields,
  }
}

function block(txs: RawTransaction[], receipts: RawReceipt[] | null = null) {
  const raw: RawBlock = {
    number: '0x1', hash: `0x${'11'.repeat(32)}`, parentHash: `0x${'22'.repeat(32)}`,
    timestamp: '0x1', gasUsed: '0x0', gasLimit: '0x1', baseFeePerGas: hex(BASE_FEE),
    miner: `0x${'00'.repeat(20)}`, transactions: txs,
  }
  return processBlock(raw, [], receipts)
}

const tips = (txs: Transaction[]) => txs.map((tx) => effectivePriorityFee(tx, BASE_FEE))

describe('effectivePriorityFee', () => {
  // Observed on Base mainnet block 59232450: maxFee == maxPriorityFee == 20000002.
  const capped = rawTx(0, { maxFeePerGas: hex(20_000_002n), maxPriorityFeePerGas: hex(20_000_002n), gasPrice: hex(20_000_002n) })

  test('uses the receipt effective gas price', () => {
    const b = block([capped], [{ transactionHash: capped.hash, gasUsed: '0x5208', effectiveGasPrice: hex(20_000_002n) }])
    assert.deepEqual(tips(b.transactions), [15_000_002n])
  })

  test('caps the tip at maxFee - baseFee without receipts', () => {
    assert.deepEqual(tips(block([capped]).transactions), [15_000_002n])
  })

  test('uses the tip cap when the fee cap leaves room', () => {
    const tx = rawTx(0, { maxFeePerGas: hex(100_000_000n), maxPriorityFeePerGas: hex(1_000n) })
    assert.deepEqual(tips(block([tx]).transactions), [1_000n])
  })

  test('legacy and deposit txs', () => {
    const legacy = rawTx(0, { type: '0x0', gasPrice: hex(BASE_FEE + 7n) })
    const deposit = rawTx(1, { type: '0x7e', gasPrice: '0x0' })
    assert.deepEqual(tips(block([legacy, deposit]).transactions), [7n, 0n])
  })
})

describe('findTipRises', () => {
  const tipped = (index: number, tip: bigint, from = `0x${index.toString(16).padStart(40, '0')}`) =>
    rawTx(index, { from, maxFeePerGas: hex(10n ** 12n), maxPriorityFeePerGas: hex(tip) })

  test('flags sequencer txs tipping more than their predecessor, skipping system and user deposits', () => {
    const sameSender = `0x${'cc'.repeat(20)}`
    const txs = block([
      rawTx(0, { type: '0x7e' }),          // L1 info
      rawTx(1, { type: '0x7e' }),          // BaseTime
      rawTx(2, { type: '0x7e' }),          // user deposit: tip 0 must not count as a predecessor
      tipped(3, 50n),
      tipped(4, 40n),
      tipped(5, 90n),                       // backrun-like rise over tx 4
      tipped(6, 10n, sameSender),
      tipped(7, 20n, sameSender),           // same-sender ascending tips
      tipped(8, 20n),                       // equal tip is not a rise
    ]).transactions

    const rises = findTipRises(txs, BASE_FEE)
    assert.deepEqual([...rises.keys()], [txs[5].hash, txs[7].hash])
    assert.deepEqual(rises.get(txs[5].hash), { previousHash: txs[4].hash, sameSender: false })
    assert.deepEqual(rises.get(txs[7].hash), { previousHash: txs[6].hash, sameSender: true })
  })
})
