// Regression coverage for EVENT_ABI_MAP / decodeLog on the Uniswap V3 NonfungiblePositionManager
// and pool-level events. calldataDecoder.ts previously duplicated the (pre-fix) IncreaseLiquidity
// and Collect topic hashes as literal map keys, so the topic-hash correction in protocols.ts did
// not propagate to log decoding used by the transaction-detail UI. These tests key off the shared
// topic constants (not literals) so a future drift between the two would be caught here, and they
// verify the named fields decode from the correct indexed/data positions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EVENT_ABI_MAP, decodeLog } from '../src/lib/calldataDecoder'
import {
  UNI_V3_INCREASE_LIQ_TOPIC,
  UNI_V3_DECREASE_LIQ_TOPIC,
  UNI_V3_COLLECT_TOPIC,
  UNI_V3_POOL_COLLECT_TOPIC,
} from '../src/lib/protocols'
import { encodeData, wordAddress, wordUint } from './helpers'

const RECIPIENT = '0x444444444444444444444444444444444444444d'
const OWNER = '0x198ef1ec325a96cc354c7266a038be8b5c558f67' // e.g. the NftPM contract address

function paramValue(log: ReturnType<typeof decodeLog>, name: string) {
  return log?.params.find((p) => p.name === name)?.value
}

test('EVENT_ABI_MAP is keyed by the current (corrected) topic constants, not stale literals', () => {
  assert.equal(EVENT_ABI_MAP[UNI_V3_INCREASE_LIQ_TOPIC]?.name, 'IncreaseLiquidity')
  assert.equal(EVENT_ABI_MAP[UNI_V3_DECREASE_LIQ_TOPIC]?.name, 'DecreaseLiquidity')
  assert.equal(EVENT_ABI_MAP[UNI_V3_COLLECT_TOPIC]?.name, 'Collect')
  assert.equal(EVENT_ABI_MAP[UNI_V3_POOL_COLLECT_TOPIC]?.name, 'Collect')
})

test('decodeLog: NftPM IncreaseLiquidity decodes tokenId (indexed) and liquidity/amount0/amount1 (data) correctly', () => {
  const topics = [UNI_V3_INCREASE_LIQ_TOPIC, '0x' + wordUint(7n)]
  const data = encodeData([wordUint(500n), wordUint(111n), wordUint(222n)])
  const log = decodeLog(topics, data, UNI_V3_INCREASE_LIQ_TOPIC)
  assert.equal(log?.name, 'IncreaseLiquidity')
  assert.deepEqual(paramValue(log, 'tokenId'), { kind: 'uint', value: 7n, bits: 256 })
  assert.deepEqual(paramValue(log, 'liquidity'), { kind: 'uint', value: 500n, bits: 128 })
  assert.deepEqual(paramValue(log, 'amount0'), { kind: 'uint', value: 111n, bits: 256 })
  assert.deepEqual(paramValue(log, 'amount1'), { kind: 'uint', value: 222n, bits: 256 })
})

test('decodeLog: NftPM Collect decodes tokenId (indexed), recipient, amount0Collected, amount1Collected correctly', () => {
  const topics = [UNI_V3_COLLECT_TOPIC, '0x' + wordUint(9n)]
  const data = encodeData([wordAddress(RECIPIENT), wordUint(11n), wordUint(21n)])
  const log = decodeLog(topics, data, UNI_V3_COLLECT_TOPIC)
  assert.equal(log?.name, 'Collect')
  assert.deepEqual(paramValue(log, 'tokenId'), { kind: 'uint', value: 9n, bits: 256 })
  assert.deepEqual(paramValue(log, 'recipient'), { kind: 'address', hex: RECIPIENT })
  assert.deepEqual(paramValue(log, 'amount0Collected'), { kind: 'uint', value: 11n, bits: 256 })
  assert.deepEqual(paramValue(log, 'amount1Collected'), { kind: 'uint', value: 21n, bits: 256 })
})

test('decodeLog: pool-level Collect decodes owner/tickLower/tickUpper (indexed) and recipient/amount0/amount1 (data) correctly', () => {
  const topics = [
    UNI_V3_POOL_COLLECT_TOPIC,
    '0x' + wordAddress(OWNER),
    '0x' + wordUint(100n), // tickLower
    '0x' + wordUint(200n), // tickUpper
  ]
  const data = encodeData([wordAddress(RECIPIENT), wordUint(11n), wordUint(21n)])
  const log = decodeLog(topics, data, UNI_V3_POOL_COLLECT_TOPIC)
  assert.equal(log?.name, 'Collect')
  assert.deepEqual(paramValue(log, 'owner'), { kind: 'address', hex: OWNER })
  assert.deepEqual(paramValue(log, 'recipient'), { kind: 'address', hex: RECIPIENT })
  assert.deepEqual(paramValue(log, 'tickLower'), { kind: 'int', value: 100n, bits: 24 })
  assert.deepEqual(paramValue(log, 'tickUpper'), { kind: 'int', value: 200n, bits: 24 })
  assert.deepEqual(paramValue(log, 'amount0'), { kind: 'uint', value: 11n, bits: 128 })
  assert.deepEqual(paramValue(log, 'amount1'), { kind: 'uint', value: 21n, bits: 128 })
})
