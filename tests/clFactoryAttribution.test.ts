import { test } from 'node:test'
import assert from 'node:assert/strict'
import { processLogs, detectProtocolHint } from '../src/lib/logProcessing'
import { FACTORY_PROTOCOLS, fetchPoolMeta } from '../src/lib/poolFetch'
import {
  KNOWN_PROTOCOLS,
  PROTOCOL_CLASSIFICATION,
  PROTOCOL_COLORS,
  UNI_V3_SWAP_TOPIC,
} from '../src/lib/protocols'
import type { RpcClient } from '../src/lib/rpc'
import type { Log } from '../src/types'
import { wordUint } from './helpers'

const AERODROME_CL_FACTORIES = [
  '0xf8f2eb4940cfe7d13603dddd87f123820fc061ef',
  '0x5e7bb104d84c7cb9b682aac2f3d509f5f406809a',
  '0xade65c38cd4849adba595a4323a8c7ddfe89716a',
  '0x9592cd9b267748cbfbde90ac9f7df3c437a6d51b',
]
const AERODROME_CLASSIC_FACTORY = '0x420dd381b31aef6683db6b902084cb0ffece40da'
const BASESWAP_V3_FACTORIES = [
  '0x38015d05f4fec8afe15d7cc0386a126574e8077b',
  '0xaed85e1d0c7e6e18335b9ea858ce1ab06934eab5',
]
const NINEMM_V3_FACTORY = '0x7b72c4002ea7c276dd717b96b20f4956c5c904e7'
const AERODROME_VOTER = '0x16613524e02ad97edfef371bc883f2f5d6c480a5'
const DEAD_AERODROME_VOTER_TYPO = '0x827922686190fd9b3eb5c2af8154a8ab3efb61d5'
const POOL = '0x1111111111111111111111111111111111111111'
const TOKEN0 = '0x2222222222222222222222222222222222222222'
const TOKEN1 = '0x3333333333333333333333333333333333333333'

function encodedAddress(address: string): string {
  return `0x${address.slice(2).padStart(64, '0')}`
}

function poolClient(factory: string): RpcClient {
  return {
    async call(_method: string, params: unknown[]) {
      const data = (params[0] as { data: string }).data
      if (data === '0x0dfe1681') return encodedAddress(TOKEN0)
      if (data === '0xd21220a7') return encodedAddress(TOKEN1)
      if (data === '0xc45a0155') return encodedAddress(factory)
      return '0x'
    },
  } as RpcClient
}

function swapLog(): Log {
  return {
    address: POOL,
    topics: [UNI_V3_SWAP_TOPIC],
    data: `0x${wordUint(1n)}${wordUint(2n)}`,
    transactionHash: '0xtest',
    logIndex: 0,
  }
}

test('factory registry classifies every official Aerodrome CL generation as concentrated liquidity', () => {
  for (const factory of AERODROME_CL_FACTORIES) {
    assert.equal(FACTORY_PROTOCOLS[factory], 'Aerodrome CL', factory)
    assert.equal(PROTOCOL_CLASSIFICATION[FACTORY_PROTOCOLS[factory]], 'Concentrated Liquidity', factory)
    assert.equal(KNOWN_PROTOCOLS[factory]?.type, 'dex', factory)
    assert.match(KNOWN_PROTOCOLS[factory]?.name ?? '', /^Aerodrome CL Factory/, factory)
    assert.equal(detectProtocolHint(factory), 'aerodrome', factory)
  }

  assert.equal(FACTORY_PROTOCOLS[AERODROME_CLASSIC_FACTORY], 'Aerodrome')
  assert.equal(PROTOCOL_CLASSIFICATION[FACTORY_PROTOCOLS[AERODROME_CLASSIC_FACTORY]], 'Classic AMM')
})

test('factory registry includes active and historical BaseSwap V3 factories', () => {
  for (const factory of BASESWAP_V3_FACTORIES) {
    assert.equal(FACTORY_PROTOCOLS[factory], 'BaseSwap V3', factory)
    assert.equal(PROTOCOL_CLASSIFICATION[FACTORY_PROTOCOLS[factory]], 'Concentrated Liquidity', factory)
    assert.equal(KNOWN_PROTOCOLS[factory]?.type, 'dex', factory)
    assert.match(KNOWN_PROTOCOLS[factory]?.name ?? '', /^BaseSwap V3 Factory/, factory)
  }
})

test('official 9mm Base V3 factory resolves as branded concentrated liquidity', async () => {
  assert.equal(FACTORY_PROTOCOLS[NINEMM_V3_FACTORY], '9mm V3')
  assert.deepEqual(KNOWN_PROTOCOLS[NINEMM_V3_FACTORY], { name: '9mm V3 Factory', type: 'dex' })
  assert.equal(PROTOCOL_CLASSIFICATION['9mm V3'], 'Concentrated Liquidity')
  assert.equal(PROTOCOL_COLORS['9mm V3'], '#c8a84e')

  const meta = await fetchPoolMeta(poolClient(NINEMM_V3_FACTORY), POOL)
  const resolved = processLogs([swapLog()], null, new Map([[POOL, meta.protocol]]))
  assert.equal(meta.protocol, '9mm V3')
  assert.equal(resolved.protocols[0].protocol, '9mm V3')
})

test('official Aerodrome voter replaces the dead mistyped address', () => {
  assert.deepEqual(KNOWN_PROTOCOLS[AERODROME_VOTER], { name: 'Aerodrome Voter', type: 'dex' })
  assert.equal(detectProtocolHint(AERODROME_VOTER), 'aerodrome')
  assert.equal(KNOWN_PROTOCOLS[DEAD_AERODROME_VOTER_TYPO], undefined)
  assert.equal(detectProtocolHint(DEAD_AERODROME_VOTER_TYPO), null)
})

test('factory-resolved Aerodrome CL names replace Unknown CL in processLogs, including ade65', async () => {
  for (const factory of [AERODROME_CL_FACTORIES[0], AERODROME_CL_FACTORIES[2]]) {
    const meta = await fetchPoolMeta(poolClient(factory), POOL)
    assert.equal(meta.factory, factory)
    assert.equal(meta.protocol, 'Aerodrome CL')

    const unresolved = processLogs([swapLog()])
    assert.equal(unresolved.protocols[0].protocol, 'Unknown CL')

    const resolved = processLogs([swapLog()], null, new Map([[POOL, meta.protocol]]))
    assert.equal(resolved.protocols[0].protocol, 'Aerodrome CL')
  }
})
