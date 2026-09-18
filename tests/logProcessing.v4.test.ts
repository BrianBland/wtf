import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Log, ProtocolEvent } from '../src/types'
import { processLogs } from '../src/lib/logProcessing'
import { V4PoolKey } from '../src/lib/v4PoolKey'
import { UNI_V4_POOL_MANAGER_ADDRESS, UNI_V4_SWAP_TOPIC, ETH_NATIVE_ADDRESS, WETH_ADDRESS, TRANSFER_TOPIC } from '../src/lib/protocols'

// ── Live repro fixture ──────────────────────────────────────────────────────
// tx 0x75728f7a6090800f85faf0aafee2e342e9f0fc84ff42025fc48032d3741e6e8f, block 51480862 (Base).
// No RPC URL used — PoolKey and deltas below are fixture constants from that transaction.

const POOL_ID = '0x53e8e57ca9ed0e35d7d7b5505188e0f075d25beb3a348bd6941af736d4d94be5'
const CURRENCY1 = '0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf'
const HOOKS = '0xef8f0fe5ddaddafe51889588703b716a89b0d4c0'

const NATIVE_POOL_KEY: V4PoolKey = {
  currency0: '0x0000000000000000000000000000000000000000',
  currency1: CURRENCY1,
  fee: 75,
  tickSpacing: 400,
  hooks: HOOKS,
}

const WETH_POOL_ID = '0x' + 'aa'.repeat(32)
const OTHER_TOKEN = '0x00000000000000000000000000000000000abc'
const WETH_POOL_KEY: V4PoolKey = {
  currency0: WETH_ADDRESS,
  currency1: OTHER_TOKEN,
  fee: 3000,
  tickSpacing: 60,
  hooks: '0x0000000000000000000000000000000000000000',
}

function pad32(hex: string): string {
  return hex.replace(/^0x/, '').padStart(64, '0')
}

function enc128(v: bigint): string {
  return pad32(BigInt.asUintN(256, v).toString(16))
}

function swapLog(poolId: string, amount0: bigint, amount1: bigint, logIndex = 0): Log {
  const data =
    '0x' +
    enc128(amount0) +
    enc128(amount1) +
    pad32('0') + // sqrtPriceX96
    pad32('0') + // liquidity
    pad32('0') + // tick
    pad32('0')   // fee
  return {
    address: UNI_V4_POOL_MANAGER_ADDRESS,
    topics: [UNI_V4_SWAP_TOPIC, poolId, '0x' + pad32('0x0000000000000000000000000000000000000001')],
    data,
    transactionHash: '0x75728f7a6090800f85faf0aafee2e342e9f0fc84ff42025fc48032d3741e6e8f',
    logIndex,
  }
}

function v4Swaps(events: ProtocolEvent[]): ProtocolEvent[] {
  return events.filter((e) => e.protocol === 'Uniswap V4' && e.action === 'Swap')
}

describe('processLogs — Uniswap V4 swap correctness', () => {
  test('resolves both swap directions from a single event using the PoolKey + sign of the deltas', () => {
    const keys = new Map([[POOL_ID, NATIVE_POOL_KEY]])

    // currency0 (native) negative → input; currency1 positive → output
    const zeroForOne = processLogs([swapLog(POOL_ID, -10_968_386_505_338_880n, 1_048_652_907_829_018_310n)], null, new Map(), keys)
    const ev1 = v4Swaps(zeroForOne.protocols)[0]
    assert.equal(ev1.extra?.tokenIn, ETH_NATIVE_ADDRESS)
    assert.equal(ev1.extra?.amountIn, '10968386505338880')
    assert.equal(ev1.extra?.tokenOut, CURRENCY1)
    assert.equal(ev1.extra?.amountOut, '1048652907829018310')

    // currency1 negative → input; currency0 (native) positive → output (opposite direction)
    const oneForZero = processLogs([swapLog(POOL_ID, 1_048_652_907_829_018_310n, -10_968_386_505_338_880n)], null, new Map(), keys)
    const ev2 = v4Swaps(oneForZero.protocols)[0]
    assert.equal(ev2.extra?.tokenIn, CURRENCY1)
    assert.equal(ev2.extra?.amountIn, '10968386505338880')
    assert.equal(ev2.extra?.tokenOut, ETH_NATIVE_ADDRESS)
    assert.equal(ev2.extra?.amountOut, '1048652907829018310')
  })

  test('maps the zero-address PoolKey currency to the native ETH sentinel, never fetched as an ERC-20', () => {
    const keys = new Map([[POOL_ID, NATIVE_POOL_KEY]])
    const { protocols } = processLogs([swapLog(POOL_ID, -1000n, 2000n)], null, new Map(), keys)
    const ev = v4Swaps(protocols)[0]
    assert.equal(ev.extra?.currency0, ETH_NATIVE_ADDRESS)
    assert.equal(ev.extra?.tokenIn, ETH_NATIVE_ADDRESS)
  })

  test('keeps WETH distinct from native ETH — a WETH PoolKey currency is never sentinel-mapped', () => {
    const keys = new Map([[WETH_POOL_ID, WETH_POOL_KEY]])
    const { protocols } = processLogs([swapLog(WETH_POOL_ID, -500n, 700n)], null, new Map(), keys)
    const ev = v4Swaps(protocols)[0]
    assert.equal(ev.extra?.currency0, WETH_ADDRESS)
    assert.notEqual(ev.extra?.currency0, ETH_NATIVE_ADDRESS)
    assert.equal(ev.extra?.tokenIn, WETH_ADDRESS)
  })

  test('repeated swaps in the same pool each get their own distinct amounts (no first-output repetition)', () => {
    const keys = new Map([[POOL_ID, NATIVE_POOL_KEY]])
    const logs = [
      swapLog(POOL_ID, -10_968_386_505_338_880n, 1_048_652_907_829_018_310n, 0),
      swapLog(POOL_ID, -7_211_758_519_368_161n, 688_011_183_953_565_381n, 1),
    ]
    const { protocols } = processLogs(logs, null, new Map(), keys)
    const swaps = v4Swaps(protocols)
    assert.equal(swaps.length, 2)
    assert.equal(swaps[0].extra?.amountIn, '10968386505338880')
    assert.equal(swaps[0].extra?.amountOut, '1048652907829018310')
    assert.equal(swaps[1].extra?.amountIn, '7211758519368161')
    assert.equal(swaps[1].extra?.amountOut, '688011183953565381')
    assert.notEqual(swaps[0].extra?.amountOut, swaps[1].extra?.amountOut)
  })

  test('multihop: two different pools in one tx each resolve independently from their own PoolKey', () => {
    const keys = new Map([[POOL_ID, NATIVE_POOL_KEY], [WETH_POOL_ID, WETH_POOL_KEY]])
    const logs = [
      swapLog(POOL_ID, -1000n, 2000n, 0),
      swapLog(WETH_POOL_ID, -2000n, 3000n, 1),
    ]
    const { protocols } = processLogs(logs, null, new Map(), keys)
    const swaps = v4Swaps(protocols)
    assert.equal(swaps.length, 2)
    assert.equal(swaps[0].extra?.tokenIn, ETH_NATIVE_ADDRESS)
    assert.equal(swaps[0].extra?.amountIn, '1000')
    assert.equal(swaps[1].extra?.tokenIn, WETH_ADDRESS)
    assert.equal(swaps[1].extra?.amountIn, '2000')
  })

  test('zero-delta swap gets no fabricated settlement, but raw deltas are preserved', () => {
    const keys = new Map([[POOL_ID, NATIVE_POOL_KEY]])
    const { protocols } = processLogs([swapLog(POOL_ID, 0n, 0n)], null, new Map(), keys)
    const ev = v4Swaps(protocols)[0]
    assert.equal(ev.extra?.amount0, '0')
    assert.equal(ev.extra?.amount1, '0')
    assert.equal(ev.extra?.tokenIn, undefined)
    assert.equal(ev.extra?.amountIn, undefined)
    assert.equal(ev.extra?.tokenOut, undefined)
    assert.equal(ev.extra?.amountOut, undefined)
  })

  test('unrelated/equal-amount ERC-20 transfers in the same tx never influence the resolved swap amounts', () => {
    const keys = new Map([[POOL_ID, NATIVE_POOL_KEY]])
    const swap = swapLog(POOL_ID, -1000n, 2000n)
    const distractorTransfer: Log = {
      address: '0x0000000000000000000000000000000000dead',
      topics: [TRANSFER_TOPIC, '0x' + pad32('0x1'), '0x' + pad32('0x2')],
      data: '0x' + pad32((1000).toString(16)), // same magnitude as amount0 — must not be picked up
      transactionHash: swap.transactionHash,
      logIndex: 1,
    }
    const { protocols, tokenFlows } = processLogs([swap, distractorTransfer], null, new Map(), keys)
    assert.equal(tokenFlows.length, 1) // the unrelated transfer is decoded as a normal token flow...
    const ev = v4Swaps(protocols)[0]
    // ...but it never leaks into the swap's tokenIn/tokenOut — those come only from the PoolKey + deltas.
    assert.equal(ev.extra?.tokenIn, ETH_NATIVE_ADDRESS)
    assert.equal(ev.extra?.amountIn, '1000')
    assert.equal(ev.extra?.tokenOut, CURRENCY1)
    assert.equal(ev.extra?.amountOut, '2000')
  })

  test('unknown PoolKey: honest fallback — raw PoolId/deltas preserved, no currency/amount fabricated', () => {
    const { protocols } = processLogs([swapLog(POOL_ID, -1000n, 2000n)], null, new Map(), new Map())
    const ev = v4Swaps(protocols)[0]
    assert.equal(ev.extra?.pool, POOL_ID)
    assert.equal(ev.extra?.amount0, '-1000')
    assert.equal(ev.extra?.amount1, '2000')
    assert.equal(ev.extra?.currency0, undefined)
    assert.equal(ev.extra?.tokenIn, undefined)
    assert.equal(ev.extra?.tokenOut, undefined)
  })

  test('safe generic consumer: processLogs works with the default (empty) v4PoolKeys map', () => {
    assert.doesNotThrow(() => processLogs([swapLog(POOL_ID, -1000n, 2000n)]))
  })
})

// PoolKey fee may be the dynamic-fee flag, not the effective fee on this swap.
test('V4 key fee is labeled poolFee, not actual swap fee', () => {
  const key = { ...NATIVE_POOL_KEY, fee: 0x800000 }
  const { protocols } = processLogs([swapLog(POOL_ID, -1n, 1n)], null, new Map(), new Map([[POOL_ID, key]]))
  assert.equal(protocols[0].extra?.poolFee, 0x800000)
  assert.equal(protocols[0].extra?.fee, undefined)
})
