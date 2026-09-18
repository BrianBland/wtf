import { decodeLog } from '../src/lib/calldataDecoder.ts'
// Focused offline synthetic-fixture tests for two dormant decoder correctness bugs:
//   1. AMM_BURN_TOPIC had the wrong keccak256 hash (source: src/lib/protocols.ts).
//   2. AAVE_FLASH_LOAN_TOPIC had the wrong hash, and its decoder read the wrong
//      topic (referral instead of asset) and the wrong data word (initiator
//      instead of amount).
//
// These topics are hardcoded here independently from src/lib/protocols.ts
// (rather than imported) so a regression that reintroduces the wrong hash in
// the source is still caught by these tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { processLogs } from '../src/lib/logProcessing.ts'
import { AAVE_V3_POOL_ADDRESS, SEAMLESS_POOL_ADDRESS } from '../src/lib/protocols.ts'
import type { Log } from '../src/types.ts'

// Canonical keccak256("Burn(address,uint256,uint256,address)")
// See https://github.com/Uniswap/v2-core/blob/master/contracts/interfaces/IUniswapV2Pair.sol
const CANONICAL_AMM_BURN_TOPIC =
  '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496'

// Canonical keccak256("FlashLoan(address,address,address,uint256,uint8,uint256,uint16)")
// See https://github.com/aave/aave-v3-origin/blob/main/src/contracts/interfaces/IPool.sol
const CANONICAL_AAVE_FLASH_LOAN_TOPIC =
  '0xefefaba5e921573100900a3ad9cf29f222d995fb3b6045797eaea7521bd8d6f0'

function addrTopic(addr: string): string {
  return '0x' + '0'.repeat(24) + addr.slice(2).toLowerCase()
}

function uintTopic(n: bigint | number): string {
  return '0x' + BigInt(n).toString(16).padStart(64, '0')
}

function uintWord(n: bigint | number): string {
  return BigInt(n).toString(16).padStart(64, '0')
}

function addrWord(addr: string): string {
  return '0'.repeat(24) + addr.slice(2).toLowerCase()
}

function baseLog(overrides: Partial<Log>): Log {
  return {
    address: '0x0000000000000000000000000000000000000001',
    topics: [],
    data: '0x',
    transactionHash: '0xtest',
    logIndex: 0,
    ...overrides,
  }
}

// ── AMM Burn (Uniswap V2 / Aerodrome) ──────────────────────────────────────

test('AMM Burn: decodes amount0/amount1 and labels via corrected canonical topic', () => {
  const pool = '0x3f972846d441711e4b046b7d4e15bc71eeeca4db'
  const sender = '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24'
  const amount0 = 17_000_000_000_000_000_000n
  const amount1 = 4_500_000n

  const log = baseLog({
    address: pool,
    topics: [CANONICAL_AMM_BURN_TOPIC, addrTopic(sender), addrTopic(sender)],
    data: '0x' + uintWord(amount0) + uintWord(amount1),
  })

  const { protocols } = processLogs([log])
  assert.equal(protocols.length, 1, 'expected exactly one AMM Burn event to be recognized')
  const evt = protocols[0]
  assert.equal(evt.action, 'RemoveLiquidity')
  assert.equal(evt.extra?.pool, pool)
  assert.equal(evt.extra?.amount0, amount0.toString())
  assert.equal(evt.extra?.amount1, amount1.toString())
})

test('AMM Burn: uses resolved pool protocol from factory lookup over generic fallback', () => {
  const pool = '0x3f972846d441711e4b046b7d4e15bc71eeeca4db'
  const sender = '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24'

  const log = baseLog({
    address: pool,
    topics: [CANONICAL_AMM_BURN_TOPIC, addrTopic(sender), addrTopic(sender)],
    data: '0x' + uintWord(1n) + uintWord(2n),
  })

  const poolProtocols = new Map([[pool, 'Uniswap V2']])
  const { protocols } = processLogs([log], null, poolProtocols)
  assert.equal(protocols.length, 1)
  assert.equal(protocols[0].protocol, 'Uniswap V2')
})

test('AMM Burn: falls back to conservative label when pool protocol is unresolved', () => {
  const pool = '0x3f972846d441711e4b046b7d4e15bc71eeeca4db'
  const sender = '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24'

  const log = baseLog({
    address: pool,
    topics: [CANONICAL_AMM_BURN_TOPIC, addrTopic(sender), addrTopic(sender)],
    data: '0x' + uintWord(1n) + uintWord(2n),
  })

  const { protocols } = processLogs([log])
  assert.equal(protocols.length, 1)
  assert.equal(protocols[0].protocol, 'Unknown AMM')
})

// ── Aave V3 FlashLoan ───────────────────────────────────────────────────────

// Real-shape fixture (fields deliberately distinct so offset bugs can't hide):
//   target     = AAVE_V3_POOL caller (topic1)
//   asset      = token being borrowed (topic2)         <- was misread from topic3 (referral)
//   referral   = uint16 (topic3)
//   initiator  = data word 0
//   amount     = data word 1                            <- was misread from data word 0 (initiator)
//   mode       = data word 2
//   premium    = data word 3
test('Aave FlashLoan: reads asset from topic2 and amount from data word1 (not referral/initiator)', () => {
  const target = '0xdecc46a4b09162f5369c5c80383aaa9159bcf192'
  const asset = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' // USDC
  const initiator = '0x' + '11'.repeat(18) + 'aaab' // deliberately != target
  const amount = 6_000_000n // 6 USDC (distinct from initiator/referral bit patterns)
  const referral = 0x10ccn
  const mode = 0n
  const premium = 12_345n

  const log = baseLog({
    address: AAVE_V3_POOL_ADDRESS,
    topics: [
      CANONICAL_AAVE_FLASH_LOAN_TOPIC,
      addrTopic(target),
      addrTopic(asset),
      uintTopic(referral),
    ],
    data:
      '0x' +
      addrWord(initiator) +
      uintWord(amount) +
      uintWord(mode) +
      uintWord(premium),
  })

  const { protocols } = processLogs([log])
  assert.equal(protocols.length, 1, 'expected exactly one Aave FlashLoan event to be recognized')
  const evt = protocols[0]
  assert.equal(evt.protocol, 'Aave V3')
  assert.equal(evt.action, 'Flash Loan')
  assert.equal(evt.token, asset, 'token must be the asset (topic2), not the referral code (topic3)')
  assert.equal(evt.amount, amount, 'amount must be data word1, not the initiator address (data word0)')
})

test('Aave FlashLoan: labels Seamless pool distinctly while using the same corrected offsets', () => {
  const target = '0xdecc46a4b09162f5369c5c80383aaa9159bcf192'
  const asset = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
  const amount = 42n

  const log = baseLog({
    address: SEAMLESS_POOL_ADDRESS,
    topics: [
      CANONICAL_AAVE_FLASH_LOAN_TOPIC,
      addrTopic(target),
      addrTopic(asset),
      uintTopic(1n),
    ],
    data: '0x' + addrWord(target) + uintWord(amount) + uintWord(0n) + uintWord(0n),
  })

  const { protocols } = processLogs([log])
  assert.equal(protocols.length, 1)
  assert.equal(protocols[0].protocol, 'Seamless')
  assert.equal(protocols[0].token, asset)
  assert.equal(protocols[0].amount, amount)
})

test('Aave FlashLoan: ignores an untrusted emitter (address gating preserved)', () => {
  const target = '0xdecc46a4b09162f5369c5c80383aaa9159bcf192'
  const asset = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'

  const log = baseLog({
    address: '0x000000000000000000000000000000000000dead', // not Aave V3 / Seamless
    topics: [
      CANONICAL_AAVE_FLASH_LOAN_TOPIC,
      addrTopic(target),
      addrTopic(asset),
      uintTopic(1n),
    ],
    data: '0x' + addrWord(target) + uintWord(99n) + uintWord(0n) + uintWord(0n),
  })

  const { protocols } = processLogs([log])
  assert.equal(protocols.length, 0, 'flash loan from an untrusted contract must not be reported')
})

test('Aave FlashLoan: rejects a malformed log missing the asset topic (no fabricated values)', () => {
  const target = '0xdecc46a4b09162f5369c5c80383aaa9159bcf192'

  const log = baseLog({
    address: AAVE_V3_POOL_ADDRESS,
    // Missing topics[2] (asset) — shape does not match the real event.
    topics: [CANONICAL_AAVE_FLASH_LOAN_TOPIC, addrTopic(target)],
    data: '0x' + addrWord(target) + uintWord(999n) + uintWord(0n) + uintWord(0n),
  })

  const { protocols } = processLogs([log])
  assert.equal(protocols.length, 0, 'malformed flash loan log must not produce a fabricated event')
})

test('Aave FlashLoan: rejects incomplete or non-hex ABI words', () => {
  const address = '0x' + '12'.repeat(20)
  const topics = [CANONICAL_AAVE_FLASH_LOAN_TOPIC, addrTopic(address), addrTopic(address), uintTopic(0)]
  for (const data of ['0x', '0x' + addrWord(address), '0x' + addrWord(address) + 'ab'.repeat(10), '0x' + 'zz'.repeat(128)]) {
    assert.deepEqual(processLogs([baseLog({ address: AAVE_V3_POOL_ADDRESS, topics, data })]).protocols, [])
  }
  const data = '0x' + addrWord(address) + uintWord(5) + uintWord(0) + uintWord(0)
  for (const malformedTopics of [topics.slice(0, 3), [...topics.slice(0, 2), '0xab', topics[3]]]) {
    assert.deepEqual(processLogs([baseLog({ address: AAVE_V3_POOL_ADDRESS, topics: malformedTopics, data })]).protocols, [])
  }
})

test('transaction detail decodes canonical Burn without a dynamic signature', () => {
  const sender = '0x' + '12'.repeat(20)
  const recipient = '0x' + '34'.repeat(20)
  const decoded = decodeLog(
    [CANONICAL_AMM_BURN_TOPIC, addrTopic(sender), addrTopic(recipient)],
    '0x' + uintWord(17) + uintWord(29), CANONICAL_AMM_BURN_TOPIC,
  )
  assert.equal(decoded?.name, 'Burn')
  assert.deepEqual(decoded?.params.map(p => [p.name, p.indexed, p.value]), [
    ['sender', true, { kind: 'address', hex: sender }],
    ['amount0', false, { kind: 'uint', value: 17n, bits: 256 }],
    ['amount1', false, { kind: 'uint', value: 29n, bits: 256 }],
    ['to', true, { kind: 'address', hex: recipient }],
  ])
})

test('transaction detail uses the correct indexed fields for Aave FlashLoan', () => {
  const target = '0x' + '12'.repeat(20)
  const initiator = '0x' + '34'.repeat(20)
  const asset = '0x' + '56'.repeat(20)
  const decoded = decodeLog(
    [CANONICAL_AAVE_FLASH_LOAN_TOPIC, addrTopic(target), addrTopic(asset), uintTopic(4300)],
    '0x' + addrWord(initiator) + uintWord(99) + uintWord(2) + uintWord(7), CANONICAL_AAVE_FLASH_LOAN_TOPIC,
  )
  assert.equal(decoded?.name, 'FlashLoan')
  assert.deepEqual(decoded?.params.map(p => [p.name, p.indexed, p.value]), [
    ['target', true, { kind: 'address', hex: target }],
    ['initiator', false, { kind: 'address', hex: initiator }],
    ['asset', true, { kind: 'address', hex: asset }],
    ['amount', false, { kind: 'uint', value: 99n, bits: 256 }],
    ['interestRateMode', false, { kind: 'uint', value: 2n, bits: 8 }],
    ['premium', false, { kind: 'uint', value: 7n, bits: 256 }],
    ['referralCode', true, { kind: 'uint', value: 4300n, bits: 16 }],
  ])
})
