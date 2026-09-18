import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Block, ProtocolEvent, Transaction } from '../src/types'
import { buildPoolActivity } from '../src/lib/poolActivity'
import { USDC_ADDRESS, USDT_ADDRESS, WETH_ADDRESS } from '../src/lib/protocols'

const TOKEN = '0x1111111111111111111111111111111111111111'
const POOL_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const POOL_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const V4_POOL = '0x' + 'cc'.repeat(32)

function v3(pool: string, token0: string | undefined, token1: string | undefined, amount0: unknown, amount1: unknown): ProtocolEvent {
  return {
    protocol: 'Uniswap V3', action: 'Swap',
    extra: { pool, swapType: 'v3', volumeDataValid: true, token0, token1, amount0, amount1 },
  }
}

function v2(
  pool: string,
  token0: string,
  token1: string,
  amount0In: unknown,
  amount1In: unknown,
  amount0Out: unknown,
  amount1Out: unknown,
): ProtocolEvent {
  return {
    protocol: 'Aerodrome', action: 'Swap',
    extra: { pool, swapType: 'v2', volumeDataValid: true, token0, token1, amount0In, amount1In, amount0Out, amount1Out },
  }
}

function transaction(protocols: ProtocolEvent[], hash = '0xtest', tokenFlows: Transaction['tokenFlows'] = []): Transaction {
  return { hash, protocols, tokenFlows } as unknown as Transaction
}

function blocks(...transactions: Transaction[]): Block[] {
  return [{ transactions } as unknown as Block]
}

describe('buildPoolActivity pool-local swap volume', () => {
  test('maps V3 signed deltas in both directions and V2 in/out slots to local token identities', () => {
    const events = [
      v3(POOL_A, USDC_ADDRESS, WETH_ADDRESS, '2000000', '-1000000000000000000'),
      v3(POOL_A, USDC_ADDRESS, WETH_ADDRESS, '-3000000', '1500000000000000000'),
      v2(POOL_B, WETH_ADDRESS, USDC_ADDRESS, '2000000000000000000', '0', '0', '4000000'),
      v2(POOL_B, WETH_ADDRESS, USDC_ADDRESS, '0', '5000000', '2500000000000000000', '0'),
    ]
    const activity = buildPoolActivity(blocks(transaction(events)))

    assert.deepEqual(
      { usdc: activity.get(POOL_A)?.usdcVolume, weth: activity.get(POOL_A)?.wethVolume },
      { usdc: 5_000_000n, weth: 2_500_000_000_000_000_000n },
    )
    assert.deepEqual(
      { usdc: activity.get(POOL_B)?.usdcVolume, weth: activity.get(POOL_B)?.wethVolume },
      { usdc: 9_000_000n, weth: 4_500_000_000_000_000_000n },
    )
  })

  test('isolates multihop pools and ignores unrelated, equal, and router-duplicate transfers', () => {
    const misleadingTransfers: Transaction['tokenFlows'] = [
      { token: USDC_ADDRESS, from: '0xrouter', to: POOL_A, amount: 99_000_000n },
      { token: USDC_ADDRESS, from: POOL_A, to: '0xrouter', amount: 99_000_000n },
      { token: USDC_ADDRESS, from: '0xrouter', to: '0xrecipient', amount: 1_000_000n },
      { token: WETH_ADDRESS, from: '0xrouter', to: '0xrecipient', amount: 10_000_000_000_000_000_000n },
    ]
    const tx = transaction([
      v3(POOL_A, USDC_ADDRESS, TOKEN, '1000000', '-500'),
      v3(POOL_B, TOKEN, WETH_ADDRESS, '500', '-200000000000000000'),
    ], '0xmulti', misleadingTransfers)
    const activity = buildPoolActivity(blocks(tx))

    assert.equal(activity.get(POOL_A)?.usdcVolume, 1_000_000n)
    assert.equal(activity.get(POOL_A)?.wethVolume, 0n)
    assert.equal(activity.get(POOL_B)?.usdcVolume, 0n)
    assert.equal(activity.get(POOL_B)?.wethVolume, 200_000_000_000_000_000n)
  })

  test('counts one economic input side for stable-stable swaps', () => {
    const activity = buildPoolActivity(blocks(transaction([
      v3(POOL_A, USDC_ADDRESS, USDT_ADDRESS, '-900000', '1000000'),
      v2(POOL_A, USDC_ADDRESS, USDT_ADDRESS, '2000000', '0', '0', '1900000'),
    ])))
    assert.equal(activity.get(POOL_A)?.usdcVolume, 3_000_000n)
  })

  test('sums multiple swap events for the same pool and transaction', () => {
    const activity = buildPoolActivity(blocks(transaction([
      v3(POOL_A, USDC_ADDRESS, TOKEN, '100', '-1'),
      v3(POOL_A, USDC_ADDRESS, TOKEN, '200', '-2'),
      v3(POOL_A, USDC_ADDRESS, TOKEN, '-50', '1'),
    ])))
    assert.equal(activity.get(POOL_A)?.swaps, 3)
    assert.equal(activity.get(POOL_A)?.usdcVolume, 350n)
    assert.deepEqual(activity.get(POOL_A)?.txHashes, ['0xtest'])
  })

  test('LP and fee-only pool activity has zero complete volume while preserving counts', () => {
    const activity = buildPoolActivity(blocks(transaction([
      { protocol: 'Uniswap V3', action: 'AddLiquidity', extra: { pool: POOL_A } },
      { protocol: 'Uniswap V3', action: 'RemoveLiquidity', extra: { pool: POOL_A } },
      { protocol: 'Uniswap V3', action: 'CollectFees', extra: { pool: POOL_A } },
    ])))
    const pool = activity.get(POOL_A)
    assert.equal(pool?.usdcVolume, 0n)
    assert.equal(pool?.wethVolume, 0n)
    assert.equal(pool?.volumeStatus, 'complete')
    assert.deepEqual({ adds: pool?.lpAdds, removes: pool?.lpRemoves, fees: pool?.fees }, { adds: 1, removes: 1, fees: 1 })
  })

  test('withholds missing metadata and malformed event fields with an unresolved indicator', () => {
    const malformed = [
      v3(POOL_A, undefined, undefined, '1000', '-1'),
      v3(POOL_A, USDC_ADDRESS, TOKEN, '01', '-1'),
      v3(POOL_A, USDC_ADDRESS, TOKEN, '1000', '1'),
      v2(POOL_A, USDC_ADDRESS, TOKEN, '1', '1', '0', '1'),
    ]
    const pool = buildPoolActivity(blocks(transaction(malformed))).get(POOL_A)
    assert.equal(pool?.swaps, 4)
    assert.equal(pool?.usdcVolume, 0n)
    assert.equal(pool?.volumeStatus, 'unresolved')
  })

  test('keeps V4 per-pool volume unavailable', () => {
    const pool = buildPoolActivity(blocks(transaction([
      { protocol: 'Uniswap V4', action: 'Swap', extra: {
        pool: V4_POOL, swapType: 'v3', volumeDataValid: true,
        token0: USDC_ADDRESS, token1: WETH_ADDRESS, amount0: '1000', amount1: '-1',
      } },
    ]))).get(V4_POOL)
    assert.equal(pool?.swaps, 1)
    assert.equal(pool?.usdcVolume, 0n)
    assert.equal(pool?.wethVolume, 0n)
    assert.equal(pool?.volumeStatus, 'unavailable')
  })
})
