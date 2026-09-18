import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Block, Transaction, ProtocolEvent, TokenFlow } from '../src/types'
import { buildPoolActivity } from '../src/lib/poolActivity'
import { isV4PoolId } from '../src/lib/v4PoolKey'
import { USDC_ADDRESS } from '../src/lib/protocols'

const V4_POOL_A = '0x53e8e57ca9ed0e35d7d7b5505188e0f075d25beb3a348bd6941af736d4d94be5'
const V4_POOL_B = '0x' + 'ab'.repeat(32)
const V3_POOL = '0x1111111111111111111111111111111111aaaa'

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    hash: '0x' + '11'.repeat(32),
    blockNumber: 1,
    index: 0,
    from: '0xfrom00000000000000000000000000000000001',
    to: '0xto000000000000000000000000000000000002',
    value: 0n,
    gas: 0n,
    input: '0x',
    methodSelector: null,
    logs: [],
    tokenFlows: [],
    ethFlows: [],
    protocols: [],
    ...overrides,
  }
}

function block(transactions: Transaction[]): Block {
  return {
    number: 1,
    hash: '0x' + '22'.repeat(32),
    parentHash: '0x' + '33'.repeat(32),
    timestamp: 0,
    gasUsed: 0n,
    gasLimit: 0n,
    baseFeePerGas: 0n,
    miner: '0xminer000000000000000000000000000000003',
    transactions,
  }
}

function swapEvent(pool: string): ProtocolEvent {
  return { protocol: 'Uniswap V4', action: 'Swap', extra: { pool } }
}

describe('buildPoolActivity — V4 singleton pool guard', () => {
  test('withholds transaction-wide USDC/WETH volume from V4 PoolIds (they share the PoolManager address)', () => {
    const usdcTransfer: TokenFlow = { token: USDC_ADDRESS, from: '0xa', to: '0xb', amount: 1_000_000n }
    const t = tx({
      tokenFlows: [usdcTransfer],
      protocols: [swapEvent(V4_POOL_A), swapEvent(V4_POOL_B)],
    })
    const activity = buildPoolActivity([block([t])])

    assert.ok(isV4PoolId(V4_POOL_A))
    assert.ok(isV4PoolId(V4_POOL_B))
    assert.equal(activity.get(V4_POOL_A)?.usdcVolume, 0n)
    assert.equal(activity.get(V4_POOL_B)?.usdcVolume, 0n)
  })

  test('still preserves swap counts and tx hashes per PoolId even though volume is withheld', () => {
    const t = tx({ protocols: [swapEvent(V4_POOL_A), swapEvent(V4_POOL_A)] })
    const activity = buildPoolActivity([block([t])])
    const pool = activity.get(V4_POOL_A)
    assert.equal(pool?.swaps, 2)
    assert.deepEqual(pool?.txHashes, [t.hash])
  })

  test('does not withhold volume from ordinary (non-V4) address-keyed pools', () => {
    const usdcTransfer: TokenFlow = { token: USDC_ADDRESS, from: '0xa', to: '0xb', amount: 1_000_000n }
    const t = tx({
      tokenFlows: [usdcTransfer],
      protocols: [{ protocol: 'Uniswap V3', action: 'Swap', extra: { pool: V3_POOL } }],
    })
    const activity = buildPoolActivity([block([t])])
    assert.equal(activity.get(V3_POOL)?.usdcVolume, 1_000_000n)
  })
})
