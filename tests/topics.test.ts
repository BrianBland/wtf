// Verifies the Uniswap V3 NonfungiblePositionManager event topic hashes against an
// independent keccak256 implementation (js-sha3), computed from the canonical ABI
// signatures — not by re-reading the same constants under test. No network, no Foundry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keccak256 } from 'js-sha3'
import {
  UNI_V3_INCREASE_LIQ_TOPIC,
  UNI_V3_DECREASE_LIQ_TOPIC,
  UNI_V3_COLLECT_TOPIC,
  UNI_V3_POOL_COLLECT_TOPIC,
} from '../src/lib/protocols'

function topicFor(signature: string): string {
  return '0x' + keccak256(signature)
}

test('UNI_V3_INCREASE_LIQ_TOPIC matches keccak256(IncreaseLiquidity(uint256,uint128,uint256,uint256))', () => {
  assert.equal(UNI_V3_INCREASE_LIQ_TOPIC, topicFor('IncreaseLiquidity(uint256,uint128,uint256,uint256)'))
})

test('UNI_V3_DECREASE_LIQ_TOPIC matches keccak256(DecreaseLiquidity(uint256,uint128,uint256,uint256))', () => {
  assert.equal(UNI_V3_DECREASE_LIQ_TOPIC, topicFor('DecreaseLiquidity(uint256,uint128,uint256,uint256)'))
})

test('UNI_V3_COLLECT_TOPIC matches keccak256(Collect(uint256,address,uint256,uint256))', () => {
  assert.equal(UNI_V3_COLLECT_TOPIC, topicFor('Collect(uint256,address,uint256,uint256)'))
})

test('UNI_V3_POOL_COLLECT_TOPIC matches keccak256(Collect(address,address,int24,int24,uint128,uint128))', () => {
  assert.equal(UNI_V3_POOL_COLLECT_TOPIC, topicFor('Collect(address,address,int24,int24,uint128,uint128)'))
})
