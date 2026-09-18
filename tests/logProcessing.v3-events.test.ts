// Regression coverage for the Uniswap V3 NonfungiblePositionManager event handling in
// processLogs: correct ABI field decoding, and — now that the IncreaseLiquidity and Collect
// topic hashes are fixed and those branches are actually reachable — no double counting and
// no arbitrary "nearest Mint/Burn" or "manager address as pool" mis-attribution.
//
// Fixtures use realistic ABI logs: pool Mint/Burn/Collect all carry their indexed `owner` topic
// (positions are owned by the NftPM contract, not the end user), and matching duplicate pairs use
// identical liquidity/amounts — mismatched fixtures are reserved for the negative-match tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { processLogs } from '../src/lib/logProcessing'
import { buildPoolActivity } from '../src/lib/poolActivity'
import type { Block, Transaction, ProtocolEvent } from '../src/types'
import {
  UNI_V3_POOL_MINT_TOPIC,
  UNI_V3_POOL_BURN_TOPIC,
  UNI_V3_POOL_COLLECT_TOPIC,
  UNI_V3_INCREASE_LIQ_TOPIC,
  UNI_V3_COLLECT_TOPIC,
} from '../src/lib/protocols'
import { encodeData, makeLog, resetLogIndexCounter, wordAddress, wordUint } from './helpers'

const NFPM = '0x198ef1ec325a96cc354c7266a038be8b5c558f67' // Uniswap V3 NonfungiblePositionManager
const POOL_A = '0x1111111111111111111111111111111111111a'
const POOL_B = '0x2222222222222222222222222222222222222b'
const SENDER = '0x3333333333333333333333333333333333333c'
const RECIPIENT = '0x444444444444444444444444444444444444444d'
const RECIPIENT_2 = '0x555555555555555555555555555555555555555e'
const OTHER_OWNER = '0x666666666666666666666666666666666666666f' // e.g. a direct pool caller, not the NftPM

function poolMintLog(pool: string, owner: string, liquidity: bigint, amount0: bigint, amount1: bigint) {
  return makeLog({
    address: pool,
    // Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)
    topics: [UNI_V3_POOL_MINT_TOPIC, '0x' + wordAddress(owner), '0x' + wordUint(100n), '0x' + wordUint(200n)],
    data: encodeData([wordAddress(SENDER), wordUint(liquidity), wordUint(amount0), wordUint(amount1)]),
  })
}

function poolBurnLog(pool: string, owner: string, amount0: bigint, amount1: bigint) {
  return makeLog({
    address: pool,
    // Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)
    topics: [UNI_V3_POOL_BURN_TOPIC, '0x' + wordAddress(owner), '0x' + wordUint(100n), '0x' + wordUint(200n)],
    data: encodeData([wordUint(1000n), wordUint(amount0), wordUint(amount1)]),
  })
}

function poolCollectLog(pool: string, owner: string, recipient: string, amount0: bigint, amount1: bigint) {
  return makeLog({
    address: pool,
    // Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)
    topics: [UNI_V3_POOL_COLLECT_TOPIC, '0x' + wordAddress(owner), '0x' + wordUint(100n), '0x' + wordUint(200n)],
    data: encodeData([wordAddress(recipient), wordUint(amount0), wordUint(amount1)]),
  })
}

function increaseLiquidityLog(tokenId: bigint, liquidity: bigint, amount0: bigint, amount1: bigint) {
  return makeLog({
    address: NFPM,
    topics: [UNI_V3_INCREASE_LIQ_TOPIC, '0x' + wordUint(tokenId)],
    // IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    data: encodeData([wordUint(liquidity), wordUint(amount0), wordUint(amount1)]),
  })
}

function collectLog(tokenId: bigint, recipient: string, amount0: bigint, amount1: bigint) {
  return makeLog({
    address: NFPM,
    topics: [UNI_V3_COLLECT_TOPIC, '0x' + wordUint(tokenId)],
    // Collect(uint256 indexed tokenId, address recipient, uint256 amount0Collected, uint256 amount1Collected)
    data: encodeData([wordAddress(recipient), wordUint(amount0), wordUint(amount1)]),
  })
}

/** Minimal Block wrapper around a set of already-produced protocol events, for buildPoolActivity coverage. */
function blockWithProtocols(protocols: ProtocolEvent[]): Block[] {
  const tx = { hash: '0xtest', tokenFlows: [], protocols } as unknown as Transaction
  return [{ transactions: [tx] } as unknown as Block]
}

test.beforeEach(() => resetLogIndexCounter())

test('Collect ABI: amount0/amount1 decode from the correct data words (after the non-indexed recipient)', () => {
  const { protocols } = processLogs([collectLog(1n, RECIPIENT, 111n, 222n)])
  const collectEvents = protocols.filter(p => p.action === 'CollectFees')
  assert.equal(collectEvents.length, 1)
  assert.equal(collectEvents[0].extra?.amount0, '111')
  assert.equal(collectEvents[0].extra?.amount1, '222')
})

test('pool Mint + NftPM IncreaseLiquidity describing the same addition are not double counted', () => {
  const logs = [
    poolMintLog(POOL_A, NFPM, 500n, 100n, 200n),
    increaseLiquidityLog(1n, 500n, 100n, 200n),
  ]
  const { protocols } = processLogs(logs)
  const addLiquidityEvents = protocols.filter(p => p.action === 'AddLiquidity')
  assert.equal(addLiquidityEvents.length, 1, 'expected exactly one AddLiquidity event, not one per source log')
  assert.equal(addLiquidityEvents[0].extra?.pool, POOL_A)
})

test('IncreaseLiquidity duplicate suppression requires the Mint owner to be this NftPM contract', () => {
  // Same liquidity/amounts as the Increase, but minted to some other owner (e.g. a direct pool
  // caller) — this Mint cannot be the source of the NftPM's position and must not suppress it.
  const logs = [
    poolMintLog(POOL_A, OTHER_OWNER, 500n, 100n, 200n),
    increaseLiquidityLog(1n, 500n, 100n, 200n),
  ]
  const { protocols } = processLogs(logs)
  const addLiquidityEvents = protocols.filter(p => p.action === 'AddLiquidity')
  assert.equal(addLiquidityEvents.length, 2, 'unrelated-owner Mint must not suppress the Increase')
  assert.equal(addLiquidityEvents[0].extra?.pool, POOL_A)
  assert.equal(addLiquidityEvents[1].extra?.pool, undefined, 'unresolved Increase must not report a pool')
  assert.equal(addLiquidityEvents[1].extra?.manager, NFPM)
  assert.equal(addLiquidityEvents[1].extra?.tokenId, '1')
})

test('IncreaseLiquidity duplicate suppression requires matching liquidity', () => {
  const logs = [
    poolMintLog(POOL_A, NFPM, 1000n, 100n, 200n), // liquidity 1000, Increase below reports 500
    increaseLiquidityLog(1n, 500n, 100n, 200n),
  ]
  const { protocols } = processLogs(logs)
  const addLiquidityEvents = protocols.filter(p => p.action === 'AddLiquidity')
  assert.equal(addLiquidityEvents.length, 2, 'mismatched liquidity must not suppress the Increase')
  assert.equal(addLiquidityEvents[1].extra?.pool, undefined)
})

test('IncreaseLiquidity duplicate suppression requires matching amount0/amount1', () => {
  const logs = [
    poolMintLog(POOL_A, NFPM, 500n, 999n, 999n), // different amounts than the Increase below
    increaseLiquidityLog(1n, 500n, 100n, 200n),
  ]
  const { protocols } = processLogs(logs)
  const addLiquidityEvents = protocols.filter(p => p.action === 'AddLiquidity')
  assert.equal(addLiquidityEvents.length, 2, 'mismatched amounts must not suppress the Increase')
  assert.equal(addLiquidityEvents[1].extra?.pool, undefined)
})

test('standalone NftPM IncreaseLiquidity with no confirmable pool Mint has no pool, but keeps manager + tokenId identity', () => {
  // No pool-level Mint anywhere in the log set — nothing to (mis)attribute to.
  const logs = [increaseLiquidityLog(1n, 500n, 55n, 66n)]
  const { protocols } = processLogs(logs)
  const addLiquidityEvents = protocols.filter(p => p.action === 'AddLiquidity')
  assert.equal(addLiquidityEvents.length, 1)
  // Unresolved: no `pool` (avoids phantom pool activity/volume/metadata lookups downstream),
  // but manager + tokenId + amounts are preserved so the event still renders meaningfully.
  assert.equal(addLiquidityEvents[0].extra?.pool, undefined)
  assert.equal(addLiquidityEvents[0].extra?.manager, NFPM)
  assert.equal(addLiquidityEvents[0].extra?.tokenId, '1')
  assert.equal(addLiquidityEvents[0].extra?.amount0, '55')
  assert.equal(addLiquidityEvents[0].extra?.amount1, '66')
})

test('standalone NftPM IncreaseLiquidity does not borrow an unrelated pool from elsewhere in the tx', () => {
  // A matching Mint exists for pool A, but it happens *after* this IncreaseLiquidity log — it
  // cannot be the pool-level event that produced this addition, so it must not be used.
  const logs = [
    increaseLiquidityLog(1n, 500n, 55n, 66n),
    poolMintLog(POOL_A, NFPM, 500n, 55n, 66n),
  ]
  const { protocols } = processLogs(logs)
  const addLiquidityEvents = protocols.filter(p => p.action === 'AddLiquidity')
  // One from the standalone (preceding) IncreaseLiquidity fallback, one from the pool Mint itself.
  assert.equal(addLiquidityEvents.length, 2)
  assert.equal(addLiquidityEvents[0].extra?.pool, undefined)
  assert.equal(addLiquidityEvents[0].extra?.manager, NFPM)
  assert.equal(addLiquidityEvents[1].extra?.pool, POOL_A)
})

test('two fully decreased positions collected in one multicall must retain their actual, distinct pools', () => {
  // decrease all of A, decrease all of B, then collect A, then collect B.
  const logs = [
    poolBurnLog(POOL_A, NFPM, 10n, 20n),
    poolBurnLog(POOL_B, NFPM, 30n, 40n),
    poolCollectLog(POOL_A, NFPM, RECIPIENT, 11n, 21n),
    collectLog(1n, RECIPIENT, 11n, 21n),
    poolCollectLog(POOL_B, NFPM, RECIPIENT_2, 31n, 41n),
    collectLog(2n, RECIPIENT_2, 31n, 41n),
  ]
  const { protocols } = processLogs(logs)
  const collectEvents = protocols.filter(p => p.action === 'CollectFees')
  // One CollectFees per pool (the authoritative pool-level Collect); the matching manager
  // Collects are suppressed rather than reported again.
  assert.equal(collectEvents.length, 2, 'must not double count or collapse to a single pool')
  assert.equal(collectEvents[0].extra?.pool, POOL_A)
  assert.equal(collectEvents[1].extra?.pool, POOL_B, 'second Collect should attribute to pool B, not fall back to pool A')
})

test('collecting a position fully withdrawn in an earlier transaction reports the actual pool, not the manager', () => {
  // Only a pool Collect + manager Collect are present — no Mint/Burn in this log window at all.
  const logs = [
    poolCollectLog(POOL_A, NFPM, RECIPIENT, 11n, 21n),
    collectLog(1n, RECIPIENT, 11n, 21n),
  ]
  const { protocols } = processLogs(logs)
  const collectEvents = protocols.filter(p => p.action === 'CollectFees')
  assert.equal(collectEvents.length, 1, 'the matching manager Collect must be suppressed, not double counted')
  assert.equal(collectEvents[0].extra?.pool, POOL_A)
})

test('Collect matching requires the pool event owner to be this NftPM contract', () => {
  const logs = [
    poolCollectLog(POOL_A, OTHER_OWNER, RECIPIENT, 11n, 21n), // collected directly, not via NftPM
    collectLog(1n, RECIPIENT, 11n, 21n),
  ]
  const { protocols } = processLogs(logs)
  const collectEvents = protocols.filter(p => p.action === 'CollectFees')
  assert.equal(collectEvents.length, 2, 'unrelated-owner pool Collect must not suppress the manager Collect')
  assert.equal(collectEvents[0].extra?.pool, POOL_A)
  assert.equal(collectEvents[1].extra?.pool, undefined)
  assert.equal(collectEvents[1].extra?.manager, NFPM)
  assert.equal(collectEvents[1].extra?.tokenId, '1')
})

test('Collect matching requires an exact recipient match', () => {
  const logs = [
    poolCollectLog(POOL_A, NFPM, RECIPIENT, 11n, 21n),
    collectLog(1n, RECIPIENT_2, 11n, 21n), // different recipient than the pool event
  ]
  const { protocols } = processLogs(logs)
  const collectEvents = protocols.filter(p => p.action === 'CollectFees')
  assert.equal(collectEvents.length, 2)
  assert.equal(collectEvents[1].extra?.pool, undefined)
})

test('Collect matching requires exact amount0/amount1 match', () => {
  const logs = [
    poolCollectLog(POOL_A, NFPM, RECIPIENT, 11n, 21n),
    collectLog(1n, RECIPIENT, 999n, 999n), // different amounts than the pool event
  ]
  const { protocols } = processLogs(logs)
  const collectEvents = protocols.filter(p => p.action === 'CollectFees')
  assert.equal(collectEvents.length, 2)
  assert.equal(collectEvents[1].extra?.pool, undefined)
})

test('genuinely unresolved manager events have no pool and are excluded from buildPoolActivity', () => {
  const logs = [
    increaseLiquidityLog(1n, 500n, 55n, 66n), // no matching pool Mint anywhere
    collectLog(2n, RECIPIENT, 11n, 21n),      // no matching pool Collect anywhere
  ]
  const { protocols } = processLogs(logs)
  assert.equal(protocols.length, 2)
  for (const ev of protocols) {
    assert.equal(ev.extra?.pool, undefined, `${ev.action} must not report a pool when unresolved`)
  }
  const pools = buildPoolActivity(blockWithProtocols(protocols))
  assert.equal(pools.size, 0, 'unresolved manager events must not create phantom pool activity')
})
