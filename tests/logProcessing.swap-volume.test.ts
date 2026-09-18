import { test } from 'node:test'
import assert from 'node:assert/strict'
import { processLogs } from '../src/lib/logProcessing'
import { processBlock } from '../src/lib/blockProcessing'
import { buildPoolActivity } from '../src/lib/poolActivity'
import type { PoolMeta } from '../src/lib/poolFetch'
import type { RawBlock, RawLog } from '../src/types'
import {
  AERODROME_AMM_SWAP_TOPIC, AMM_SWAP_TOPIC, PANCAKE_V3_SWAP_TOPIC, UNI_V3_SWAP_TOPIC,
  USDC_ADDRESS, WETH_ADDRESS,
} from '../src/lib/protocols'
import { encodeData, makeLog, wordAddress, wordUint } from './helpers'

const POOL = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SENDER = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const RECIPIENT = '0xcccccccccccccccccccccccccccccccccccccccc'

function wordInt(value: bigint): string {
  const encoded = value < 0n ? (1n << 256n) + value : value
  return encoded.toString(16).padStart(64, '0')
}

const meta: PoolMeta = {
  token0: USDC_ADDRESS,
  token1: WETH_ADDRESS,
  factory: '0xdddddddddddddddddddddddddddddddddddddddd',
  protocol: 'Uniswap V3',
}
const metas = new Map([[POOL, meta]])
const topics = (topic: string) => [topic, `0x${wordAddress(SENDER)}`, `0x${wordAddress(RECIPIENT)}`]

test('processed Uniswap and Pancake V3 swaps carry fetched token identity and canonical signed deltas', () => {
  const uniswap = makeLog({
    address: POOL,
    topics: topics(UNI_V3_SWAP_TOPIC),
    data: encodeData([wordInt(1_000_000n), wordInt(-500n), wordUint(1n), wordUint(2n), wordInt(-1n)]),
  })
  const pancake = makeLog({
    address: POOL,
    topics: topics(PANCAKE_V3_SWAP_TOPIC),
    data: encodeData([
      wordInt(-2_000_000n), wordInt(1_000n), wordUint(1n), wordUint(2n), wordInt(1n), wordUint(3n), wordUint(4n),
    ]),
  })
  const swaps = processLogs([uniswap, pancake], null, new Map(), new Map(), metas).protocols

  assert.equal(swaps.length, 2)
  assert.deepEqual(
    swaps.map(event => ({
      type: event.extra?.swapType,
      valid: event.extra?.volumeDataValid,
      token0: event.extra?.token0,
      token1: event.extra?.token1,
      amount0: event.extra?.amount0,
      amount1: event.extra?.amount1,
    })),
    [
      { type: 'v3', valid: true, token0: USDC_ADDRESS, token1: WETH_ADDRESS, amount0: '1000000', amount1: '-500' },
      { type: 'v3', valid: true, token0: USDC_ADDRESS, token1: WETH_ADDRESS, amount0: '-2000000', amount1: '1000' },
    ],
  )
})

test('processed classic AMM swaps carry fetched token identity and local in/out slots', () => {
  const log = makeLog({
    address: POOL,
    topics: topics(AMM_SWAP_TOPIC),
    data: encodeData([wordUint(1_000_000n), wordUint(0n), wordUint(0n), wordUint(500n)]),
  })
  const [swap] = processLogs([log], null, new Map(), new Map(), metas).protocols
  assert.deepEqual(swap.extra, {
    pool: POOL,
    swapType: 'v2',
    volumeDataValid: true,
    amount0In: '1000000',
    amount1In: '0',
    amount0Out: '0',
    amount1Out: '500',
    token0: USDC_ADDRESS,
    token1: WETH_ADDRESS,
  })
})

test('malformed swap ABI is retained for counts but marked invalid without decoded amounts', () => {
  const malformedLength = makeLog({
    address: POOL,
    topics: topics(UNI_V3_SWAP_TOPIC),
    data: encodeData([wordInt(1n), wordInt(-1n)]),
  })
  const nonCanonicalTick = makeLog({
    address: POOL,
    topics: topics(UNI_V3_SWAP_TOPIC),
    data: encodeData([wordInt(1n), wordInt(-1n), wordUint(1n), wordUint(2n), wordUint(1n << 24n)]),
  })
  const swaps = processLogs([malformedLength, nonCanonicalTick], null, new Map(), new Map(), metas).protocols

  assert.equal(swaps.length, 2)
  for (const swap of swaps) {
    assert.equal(swap.action, 'Swap')
    assert.equal(swap.extra?.volumeDataValid, false)
    assert.equal(swap.extra?.amount0, undefined)
    assert.equal(swap.extra?.amount1, undefined)
  }
})

test('volume enrichment depends on validated PoolMeta and does not attach missing or malformed metadata', () => {
  const log = makeLog({
    address: POOL,
    topics: topics(AMM_SWAP_TOPIC),
    data: encodeData([wordUint(1n), wordUint(0n), wordUint(0n), wordUint(1n)]),
  })
  const badMeta = new Map([[POOL, { ...meta, token0: '', token1: WETH_ADDRESS }]])
  const [missing] = processLogs([log]).protocols
  const [malformed] = processLogs([log], null, new Map(), new Map(), badMeta).protocols
  assert.equal(missing.extra?.token0, undefined)
  assert.equal(malformed.extra?.token0, undefined)
})

test('Aerodrome classic raw logs flow through processBlock into pool-local volume with injected PoolMeta', () => {
  const txHash = `0x${'11'.repeat(32)}`
  const blockHash = `0x${'22'.repeat(32)}`
  const raw: RawBlock = {
    number: '0x1',
    hash: blockHash,
    parentHash: `0x${'33'.repeat(32)}`,
    timestamp: '0x1',
    gasUsed: '0x5208',
    gasLimit: '0x100000',
    baseFeePerGas: '0x1',
    miner: SENDER,
    transactions: [{
      hash: txHash,
      blockNumber: '0x1',
      transactionIndex: '0x0',
      from: SENDER,
      to: RECIPIENT,
      value: '0x0',
      input: '0x',
      gas: '0x5208',
    }],
  }
  const rawLog: RawLog = {
    address: POOL,
    topics: topics(AERODROME_AMM_SWAP_TOPIC),
    data: encodeData([wordUint(1_500_000n), wordUint(0n), wordUint(0n), wordUint(750n)]),
    blockNumber: '0x1',
    blockHash,
    transactionHash: txHash,
    transactionIndex: '0x0',
    logIndex: '0x0',
  }

  // PoolMeta is deliberately injected as the already-validated result of metadata fetching. PR B
  // only propagates it; strict RPC response integrity belongs to metadata-resilience PR C.
  const block = processBlock(
    raw,
    [rawLog],
    null,
    new Map([[POOL, 'Aerodrome']]),
    new Map(),
    new Map([[POOL, { ...meta, protocol: 'Aerodrome' }]]),
  )
  const [swap] = block.transactions[0].protocols
  assert.equal(swap.extra?.swapType, 'v2')
  assert.equal(swap.extra?.token0, USDC_ADDRESS)
  assert.equal(swap.extra?.token1, WETH_ADDRESS)

  const summary = buildPoolActivity([block]).get(POOL)
  assert.equal(summary?.swaps, 1)
  assert.equal(summary?.usdcVolume, 1_500_000n)
  assert.equal(summary?.wethVolume, 750n)
  assert.equal(summary?.volumeStatus, 'complete')
})
