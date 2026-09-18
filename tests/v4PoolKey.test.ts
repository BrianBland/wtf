import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { RawBlock, RawLog } from '../src/types'
import {
  V4PoolKey,
  isV4PoolId,
  normalizeV4Currency,
  computePoolId,
  parseInitializeEvents,
  extractV4SwapPoolIds,
  encodePoolKeysCalldata,
  decodePoolKeysResult,
  resolveV4PoolKeys,
  UNI_V4_POSITION_MANAGER_ADDRESS,
  UNI_V4_INITIALIZE_TOPIC,
} from '../src/lib/v4PoolKey'
import { loadBlockData } from '../src/lib/blockProcessing'
import { RpcClient } from '../src/lib/rpc'
import { processLogs } from '../src/lib/logProcessing'
import { UNI_V4_POOL_MANAGER_ADDRESS, UNI_V4_SWAP_TOPIC, ETH_NATIVE_ADDRESS } from '../src/lib/protocols'

// ── Fixture constants ──────────────────────────────────────────────────────
// Live repro: tx 0x75728f7a6090800f85faf0aafee2e342e9f0fc84ff42025fc48032d3741e6e8f,
// block 51480862, Base mainnet. No RPC URL required — everything below is a fixture.

const POOL_ID = '0x53e8e57ca9ed0e35d7d7b5505188e0f075d25beb3a348bd6941af736d4d94be5'
const CURRENCY0_NATIVE = '0x0000000000000000000000000000000000000000'
const CURRENCY1 = '0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf'
const FEE = 75
const TICK_SPACING = 400
const HOOKS = '0xef8f0fe5ddaddafe51889588703b716a89b0d4c0'

const FIXTURE_KEY: V4PoolKey = {
  currency0: CURRENCY0_NATIVE,
  currency1: CURRENCY1,
  fee: FEE,
  tickSpacing: TICK_SPACING,
  hooks: HOOKS,
}

function pad32(hex: string): string {
  return hex.replace(/^0x/, '').padStart(64, '0')
}

function topicAddr(addr: string): string {
  return '0x' + pad32(addr)
}

function rawLog(overrides: Partial<RawLog>): RawLog {
  return {
    address: UNI_V4_POOL_MANAGER_ADDRESS,
    topics: [],
    data: '0x',
    blockNumber: '0x311891e',
    blockHash: '0x' + '11'.repeat(32),
    transactionHash: '0x75728f7a6090800f85faf0aafee2e342e9f0fc84ff42025fc48032d3741e6e8f',
    transactionIndex: '0x0',
    logIndex: '0x0',
    ...overrides,
  }
}

function initializeLog(key: V4PoolKey, poolId: string): RawLog {
  const data =
    '0x' +
    pad32(key.fee.toString(16)) +
    pad32(BigInt.asUintN(256, BigInt(key.tickSpacing)).toString(16)) +
    pad32(key.hooks) +
    pad32('0') + // sqrtPriceX96 (unused by parser)
    pad32('0')   // tick (unused by parser)
  return rawLog({
    topics: [UNI_V4_INITIALIZE_TOPIC, poolId, topicAddr(key.currency0), topicAddr(key.currency1)],
    data,
  })
}

function swapLog(poolId: string, amount0: bigint, amount1: bigint): RawLog {
  const enc128 = (v: bigint) => pad32(BigInt.asUintN(256, v).toString(16))
  const data =
    '0x' +
    enc128(amount0) +
    enc128(amount1) +
    pad32('0') + // sqrtPriceX96
    pad32('0') + // liquidity
    pad32('0') + // tick
    pad32('0')   // fee
  return rawLog({
    topics: [UNI_V4_SWAP_TOPIC, poolId, topicAddr('0x0000000000000000000000000000000000000001')],
    data,
  })
}

// ── PoolId hashing / PositionManager calldata ──────────────────────────────

describe('computePoolId', () => {
  test('matches the live fixture PoolId for the given PoolKey', () => {
    assert.equal(computePoolId(FIXTURE_KEY), POOL_ID)
  })

  test('changes when any field changes', () => {
    assert.notEqual(computePoolId({ ...FIXTURE_KEY, fee: 76 }), POOL_ID)
    assert.notEqual(computePoolId({ ...FIXTURE_KEY, tickSpacing: 401 }), POOL_ID)
    assert.notEqual(computePoolId({ ...FIXTURE_KEY, hooks: '0x0000000000000000000000000000000000000001' }), POOL_ID)
  })
})

describe('isV4PoolId / normalizeV4Currency', () => {
  test('distinguishes a bytes32 PoolId from a 20-byte contract address', () => {
    assert.equal(isV4PoolId(POOL_ID), true)
    assert.equal(isV4PoolId(UNI_V4_POOL_MANAGER_ADDRESS), false)
    assert.equal(isV4PoolId(CURRENCY1), false)
  })

  test('maps the zero-address currency to the native ETH sentinel, leaves others untouched', () => {
    assert.equal(normalizeV4Currency(CURRENCY0_NATIVE), ETH_NATIVE_ADDRESS)
    assert.equal(normalizeV4Currency(CURRENCY1), CURRENCY1)
  })
})

describe('encodePoolKeysCalldata', () => {
  test('uses the first 25 bytes of the PoolId, right-padded to 32 bytes, after the selector', () => {
    const calldata = encodePoolKeysCalldata(POOL_ID)
    assert.equal(calldata.slice(0, 10), '0x86b6be7d')
    const word = calldata.slice(10)
    assert.equal(word.length, 64)
    const expectedPrefix = POOL_ID.slice(2, 2 + 50) // 25 bytes = 50 hex chars
    assert.equal(word.slice(0, 50), expectedPrefix)
    assert.equal(word.slice(50), '0'.repeat(14)) // 7 zero bytes of right padding
  })
})

describe('decodePoolKeysResult', () => {
  function encodeResult(key: V4PoolKey): string {
    return '0x' + pad32(key.currency0) + pad32(key.currency1) +
      pad32(key.fee.toString(16)) + pad32(BigInt.asUintN(256, BigInt(key.tickSpacing)).toString(16)) + pad32(key.hooks)
  }

  test('decodes a well-formed 5-word response', () => {
    const decoded = decodePoolKeysResult(encodeResult(FIXTURE_KEY))
    assert.deepEqual(decoded, FIXTURE_KEY)
  })

  test('rejects malformed/short ABI data', () => {
    assert.equal(decodePoolKeysResult('0x'), null)
    assert.equal(decodePoolKeysResult('0xdead'), null)
    assert.equal(decodePoolKeysResult(''), null)
  })
})

// ── Initialize event parsing ────────────────────────────────────────────────

describe('parseInitializeEvents', () => {
  test('parses a trusted Initialize event from the PoolManager', () => {
    const logs = [initializeLog(FIXTURE_KEY, POOL_ID)]
    const result = parseInitializeEvents(logs)
    assert.deepEqual(result.get(POOL_ID), FIXTURE_KEY)
  })

  test('ignores Initialize-shaped logs from a different address (untrusted source)', () => {
    const logs = [{
      ...initializeLog(FIXTURE_KEY, POOL_ID),
      address: '0x000000000000000000000000000000000000ff',
    }]
    assert.equal(parseInitializeEvents(logs).size, 0)
  })

  test('ignores logs with a different topic0', () => {
    const base = initializeLog(FIXTURE_KEY, POOL_ID)
    const logs = [{ ...base, topics: [UNI_V4_SWAP_TOPIC, ...base.topics.slice(1)] }]
    assert.equal(parseInitializeEvents(logs).size, 0)
  })
})

describe('extractV4SwapPoolIds', () => {
  test('collects distinct PoolIds referenced by Swap events, ignoring other addresses/topics', () => {
    const logs = [
      swapLog(POOL_ID, -1n, 1n),
      swapLog(POOL_ID, -2n, 2n),
      { ...swapLog('0x' + 'ab'.repeat(32), -3n, 3n) },
      { ...swapLog(POOL_ID, -4n, 4n), address: '0x000000000000000000000000000000000000ff' },
    ]
    const ids = extractV4SwapPoolIds(logs)
    assert.equal(ids.size, 2)
    assert.ok(ids.has(POOL_ID))
  })
})

// ── Fallback resolution via PositionManager eth_call ───────────────────────

interface Call { method: string; params: unknown[] }

class FakeClient {
  calls: Call[] = []
  private responses: Map<string, string | Error>
  constructor(responses: Map<string, string | Error> = new Map()) {
    this.responses = responses
  }
  setResponse(poolId: string, value: string | Error) {
    this.responses.set(poolId.toLowerCase(), value)
  }
  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    this.calls.push({ method, params })
    if (method === 'eth_chainId') return '0x2105' as T
    if (method === 'eth_call') {
      const [{ data }] = params as [{ to: string; data: string }]
      const prefix = data.slice(10, 60) // first 25 bytes of the requested PoolId
      for (const [poolId, resp] of this.responses) {
        if (poolId.slice(2, 52) === prefix) {
          if (resp instanceof Error) throw resp
          return resp as unknown as T
        }
      }
      return '0x' as unknown as T
    }
    throw new Error(`unexpected method ${method}`)
  }
}

function encodeResult(key: V4PoolKey): string {
  return '0x' + pad32(key.currency0) + pad32(key.currency1) +
    pad32(key.fee.toString(16)) + pad32(BigInt.asUintN(256, BigInt(key.tickSpacing)).toString(16)) + pad32(key.hooks)
}

describe('resolveV4PoolKeys', () => {
  test('prefers a trusted Initialize event over any eth_call fallback', async () => {
    const client = new FakeClient()
    const logs = [initializeLog(FIXTURE_KEY, POOL_ID), swapLog(POOL_ID, -1n, 1n)]
    const cache = new Map<string, V4PoolKey>()
    const resolved = await resolveV4PoolKeys(client, logs, cache, '0x311891e')
    assert.deepEqual(resolved.get(POOL_ID), FIXTURE_KEY)
    assert.deepEqual(client.calls.map(c => c.method), ['eth_chainId']) // no fallback needed
  })

  test('falls back to a verified PositionManager poolKeys() call, addressed only to the PositionManager', async () => {
    const client = new FakeClient(new Map([[POOL_ID, encodeResult(FIXTURE_KEY)]]))
    const logs = [swapLog(POOL_ID, -1n, 1n)]
    const cache = new Map<string, V4PoolKey>()
    const resolved = await resolveV4PoolKeys(client, logs, cache, '0x311891e')
    assert.deepEqual(resolved.get(POOL_ID), FIXTURE_KEY)
    assert.equal(client.calls.filter(c => c.method === 'eth_call').length, 1)
    const [{ params }] = client.calls.filter(c => c.method === 'eth_call')
    const [{ to }, blockTag] = params as [{ to: string }, string]
    assert.equal(to, UNI_V4_POSITION_MANAGER_ADDRESS)
    assert.notEqual(to, POOL_ID) // never eth_call the bytes32 PoolId as if it were an address
    assert.equal(blockTag, '0x311891e') // pinned to the requested block
  })

  test('rejects a PositionManager response whose re-hash does not match the requested PoolId', async () => {
    const wrongKey = { ...FIXTURE_KEY, fee: 3000 }
    const client = new FakeClient(new Map([[POOL_ID, encodeResult(wrongKey)]]))
    const logs = [swapLog(POOL_ID, -1n, 1n)]
    const resolved = await resolveV4PoolKeys(client, logs, new Map(), '0x311891e')
    assert.equal(resolved.has(POOL_ID), false)
  })

  test('treats a zero/uninitialized PositionManager entry as unresolved, not a guess', async () => {
    const zeroKey: V4PoolKey = { currency0: CURRENCY0_NATIVE, currency1: CURRENCY0_NATIVE, fee: 0, tickSpacing: 0, hooks: CURRENCY0_NATIVE }
    const client = new FakeClient(new Map([[POOL_ID, encodeResult(zeroKey)]]))
    const logs = [swapLog(POOL_ID, -1n, 1n)]
    const resolved = await resolveV4PoolKeys(client, logs, new Map(), '0x311891e')
    assert.equal(resolved.has(POOL_ID), false)
  })

  test('treats malformed ABI response as unresolved', async () => {
    const client = new FakeClient(new Map([[POOL_ID, '0xdead']]))
    const logs = [swapLog(POOL_ID, -1n, 1n)]
    const resolved = await resolveV4PoolKeys(client, logs, new Map(), '0x311891e')
    assert.equal(resolved.has(POOL_ID), false)
  })

  test('does not permanently poison a transport failure — a later retry can still succeed', async () => {
    const failing = new FakeClient(new Map([[POOL_ID, new Error('timeout')]]))
    const logs = [swapLog(POOL_ID, -1n, 1n)]
    const firstAttempt = await resolveV4PoolKeys(failing, logs, new Map(), '0x311891e')
    assert.equal(firstAttempt.has(POOL_ID), false)

    failing.setResponse(POOL_ID, encodeResult(FIXTURE_KEY))
    const secondAttempt = await resolveV4PoolKeys(failing, logs, new Map(), '0x311891e')
    assert.deepEqual(secondAttempt.get(POOL_ID), FIXTURE_KEY)
    assert.deepEqual(failing.calls.map(c => c.method), ['eth_chainId', 'eth_call', 'eth_call'])
  })

  test('does not re-fetch a PoolId already present in the cache', async () => {
    const client = new FakeClient(new Map([[POOL_ID, encodeResult(FIXTURE_KEY)]]))
    const logs = [swapLog(POOL_ID, -1n, 1n)]
    const cache = new Map<string, V4PoolKey>([[POOL_ID, FIXTURE_KEY]])
    const resolved = await resolveV4PoolKeys(client, logs, cache, '0x311891e')
    assert.equal(resolved.size, 0)
    assert.deepEqual(client.calls.map(c => c.method), ['eth_chainId'])
  })

  test('dedupes concurrent RPC calls for the same PoolId', async () => {
    const client = new FakeClient(new Map([[POOL_ID, encodeResult(FIXTURE_KEY)]]))
    const logs = [swapLog(POOL_ID, -1n, 1n)]
    const [a, b] = await Promise.all([
      resolveV4PoolKeys(client, logs, new Map(), '0x311891e'),
      resolveV4PoolKeys(client, logs, new Map(), '0x311891e'),
    ])
    assert.deepEqual(a.get(POOL_ID), FIXTURE_KEY)
    assert.deepEqual(b.get(POOL_ID), FIXTURE_KEY)
    assert.equal(client.calls.filter(c => c.method === 'eth_call').length, 1)
  })
})

// Regression tests for the independently reproduced resolver failures.
function wordAt(hex: string, index: number, word: string): string {
  return hex.slice(0, 2 + index * 64) + word + hex.slice(2 + (index + 1) * 64)
}
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve))

function scriptedClient(handler: (method: string, params: unknown[]) => unknown | Promise<unknown>) {
  return {
    calls: [] as Call[],
    async call<T>(method: string, params: unknown[] = []): Promise<T> {
      this.calls.push({ method, params })
      return await handler(method, params) as T
    },
  }
}

describe('V4 resolver hardening', () => {
  test('rejects removed, truncated, nonhex, noncanonical and mismatched Initialize events without caching wrong currencies', async () => {
    const valid = initializeLog(FIXTURE_KEY, POOL_ID)
    const invalid: RawLog[] = [
      { ...valid, removed: true },
      { ...valid, data: '0x' },
      { ...valid, data: valid.data.slice(0, 2 + 3 * 64) },
      { ...valid, data: valid.data + pad32('0') },
      { ...valid, topics: valid.topics.slice(0, 3) },
      { ...valid, topics: [...valid.topics, topicAddr(CURRENCY1)] },
      { ...valid, topics: [valid.topics[0], '0x' + 'ab'.repeat(32), ...valid.topics.slice(2)] },
      initializeLog({ ...FIXTURE_KEY, currency1: HOOKS }, POOL_ID),
      { ...valid, topics: [valid.topics[0], POOL_ID, '0x' + 'f'.repeat(64), valid.topics[3]] },
      { ...valid, topics: [valid.topics[0], POOL_ID, valid.topics[2], '0x' + 'g'.repeat(64)] },
      ...[0, 1, 2, 3, 4].map(i => ({ ...valid, data: wordAt(valid.data, i, 'g'.repeat(64)) })),
      ...[0, 1, 2, 3, 4].map(i => ({ ...valid, data: wordAt(valid.data, i, '1' + '0'.repeat(63)) })),
      { ...valid, data: wordAt(valid.data, 1, pad32('ffffff')) }, // int24 not sign-extended
      { ...valid, data: wordAt(valid.data, 4, pad32('800000')) },
    ]
    for (const log of invalid) assert.equal(parseInitializeEvents([log]).size, 0)
    const client = new FakeClient(new Map([[POOL_ID, encodeResult(FIXTURE_KEY)]]))
    const resolved = await resolveV4PoolKeys(client, [...invalid, swapLog(POOL_ID, -1n, 2n)], new Map())
    assert.deepEqual([...resolved], [[POOL_ID, FIXTURE_KEY]])
    assert.deepEqual(client.calls.map(c => c.method), ['eth_chainId', 'eth_call'])
    const parsed = processLogs([{ ...swapLog(POOL_ID, -1n, 2n), logIndex: 0 }], null, new Map(), resolved)
    assert.equal(parsed.protocols[0].extra?.tokenOut, CURRENCY1)
  })

  test('accepts canonical signed ABI values, including negative int24 sign extension', () => {
    const key = { ...FIXTURE_KEY, tickSpacing: -1 }
    const id = computePoolId(key)
    const log = initializeLog(key, id)
    log.data = wordAt(log.data, 4, 'f'.repeat(64))
    assert.deepEqual(parseInitializeEvents([log]).get(id), key)
    assert.deepEqual(decodePoolKeysResult(encodeResult(key)), key)
  })

  test('ignores malformed/removed Swap IDs before RPC discovery and safe event decoding', async () => {
    const valid = swapLog(POOL_ID, -1n, 1n)
    const invalid = [
      { ...valid, removed: true },
      { ...valid, topics: [UNI_V4_SWAP_TOPIC, '0x1234', valid.topics[2]] },
      { ...valid, topics: [...valid.topics, valid.topics[2]] },
      { ...valid, topics: valid.topics.slice(0, 2) },
      { ...valid, topics: [UNI_V4_SWAP_TOPIC, POOL_ID, '0x' + 'f'.repeat(64)] },
      { ...valid, data: '0x' },
      { ...valid, data: valid.data + pad32('0') },
      ...[0, 1, 2, 3, 4, 5].map(i => ({ ...valid, data: wordAt(valid.data, i, 'g'.repeat(64)) })),
      ...[0, 1, 2, 3, 4, 5].map(i => ({ ...valid, data: wordAt(valid.data, i, '1' + '0'.repeat(63)) })),
      { ...valid, data: wordAt(valid.data, 0, pad32('f'.repeat(32))) },
    ]
    assert.equal(extractV4SwapPoolIds(invalid).size, 0)
    const client = new FakeClient()
    assert.equal((await resolveV4PoolKeys(client, invalid, new Map())).size, 0)
    assert.equal(client.calls.length, 0)
    assert.equal(processLogs(invalid.map(l => ({ ...l, logIndex: 0 }))).protocols.length, 0)
  })

  test('full malformed fallback ABI fails closed with no unhandled rejection and remains retryable', async () => {
    const encoded = encodeResult(FIXTURE_KEY)
    const bad = [
      encoded + pad32('0'),
      ...[0, 1, 2, 3, 4].map(i => wordAt(encoded, i, 'g'.repeat(64))),
      ...[0, 1, 2, 3, 4].map(i => wordAt(encoded, i, '1' + '0'.repeat(63))),
      wordAt(encoded, 3, pad32('ffffff')),
    ]
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown) => { unhandled.push(error) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const client = new FakeClient()
      for (const response of bad) {
        assert.equal(decodePoolKeysResult(response), null)
        client.setResponse(POOL_ID, response)
        assert.equal((await resolveV4PoolKeys(client, [swapLog(POOL_ID, -1n, 1n)], new Map())).size, 0)
      }
      client.setResponse(POOL_ID, encodeResult(FIXTURE_KEY))
      assert.equal((await resolveV4PoolKeys(client, [swapLog(POOL_ID, -1n, 1n)], new Map())).size, 1)
      await nextTurn()
      assert.deepEqual(unhandled, [])
      assert.equal(client.calls.filter(c => c.method === 'eth_chainId').length, 1)
      assert.equal(client.calls.filter(c => c.method === 'eth_call').length, bad.length + 1)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  test('isolates pending misses across clients and requested historical blocks', async () => {
    const logs = [swapLog(POOL_ID, -1n, 1n)]
    let release!: (value: string) => void
    const waiting = new Promise<string>(resolve => { release = resolve })
    const a = scriptedClient(method => method === 'eth_chainId' ? '0x2105' : waiting)
    const b = new FakeClient(new Map([[POOL_ID, encodeResult(FIXTURE_KEY)]]))
    const miss = resolveV4PoolKeys(a, logs, new Map(), '0x1')
    await nextTurn()
    assert.deepEqual((await resolveV4PoolKeys(b, logs, new Map(), '0x1')).get(POOL_ID), FIXTURE_KEY)
    assert.deepEqual(b.calls.map(c => c.method), ['eth_chainId', 'eth_call'])
    release('0x')
    assert.equal((await miss).size, 0)

    let releaseOld!: (value: string) => void
    const old = new Promise<string>(resolve => { releaseOld = resolve })
    const client = scriptedClient((method, params) => method === 'eth_chainId' ? '0x2105'
      : params[1] === '0x1' ? old : encodeResult(FIXTURE_KEY))
    const atOld = resolveV4PoolKeys(client, logs, new Map(), '0x1')
    await nextTurn()
    const atNew = await resolveV4PoolKeys(client, logs, new Map(), '0x2')
    releaseOld('0x')
    assert.equal((await atOld).size, 0)
    assert.deepEqual(atNew.get(POOL_ID), FIXTURE_KEY)
    assert.deepEqual(client.calls.filter(c => c.method === 'eth_call').map(c => c.params[1]), ['0x1', '0x2'])
    assert.equal(client.calls.filter(c => c.method === 'eth_chainId').length, 1)
  })

  test('caps concurrent lookups at four across overlapping batches, dedupes and retries misses', async () => {
    let active = 0, maxActive = 0
    const client = scriptedClient(async method => {
      if (method === 'eth_chainId') return '0x2105'
      assert.equal(method, 'eth_call')
      active++; maxActive = Math.max(maxActive, active)
      await nextTurn()
      active--
      return '0x'
    })
    const logs = Array.from({ length: 32 }, (_, i) => swapLog('0x' + pad32((i + 1).toString(16)), -1n, 1n))
    const batches = await Promise.all([
      resolveV4PoolKeys(client, logs.slice(0, 16), new Map(), '0x1'),
      resolveV4PoolKeys(client, logs.slice(16), new Map(), '0x1'),
      resolveV4PoolKeys(client, logs, new Map(), '0x1'),
    ])
    assert.ok(batches.every(b => b.size === 0))
    assert.equal(maxActive, 4)
    assert.equal(active, 0)
    assert.equal(client.calls.filter(c => c.method === 'eth_call').length, 32)
    assert.equal(client.calls.filter(c => c.method === 'eth_chainId').length, 1)
    await resolveV4PoolKeys(client, logs.slice(0, 1), new Map(), '0x1')
    assert.equal(client.calls.filter(c => c.method === 'eth_call').length, 33)
    for (const call of client.calls.filter(c => c.method === 'eth_call')) {
      assert.equal((call.params[0] as { to: string }).to, UNI_V4_POSITION_MANAGER_ADDRESS)
    }
  })

  test('gates Initialize and fallback on memoized Base chain identity; unknown chain is retryable', async () => {
    const logs = [initializeLog(FIXTURE_KEY, POOL_ID), swapLog(POOL_ID, -1n, 1n)]
    const unsupported = scriptedClient(() => '0x1')
    assert.equal((await resolveV4PoolKeys(unsupported, logs, new Map())).size, 0)
    assert.equal((await resolveV4PoolKeys(unsupported, logs.slice(1), new Map())).size, 0)
    assert.deepEqual(unsupported.calls.map(c => c.method), ['eth_chainId'])
    for (const failure of [new Error('temporary failure'), 'garbage', null]) {
      let chainAttempts = 0
      const client = scriptedClient(method => {
        if (method !== 'eth_chainId') return encodeResult(FIXTURE_KEY)
        chainAttempts++
        if (chainAttempts === 1) {
          if (failure instanceof Error) throw failure
          return failure
        }
        return '0x2105'
      })
      assert.equal((await resolveV4PoolKeys(client, logs, new Map())).size, 0)
      assert.deepEqual(client.calls.map(c => c.method), ['eth_chainId'])
      assert.deepEqual((await resolveV4PoolKeys(client, logs, new Map())).get(POOL_ID), FIXTURE_KEY)
      assert.deepEqual((await resolveV4PoolKeys(client, logs.slice(1), new Map())).get(POOL_ID), FIXTURE_KEY)
      assert.deepEqual(client.calls.map(c => c.method), ['eth_chainId', 'eth_chainId', 'eth_call'])
    }
    const empty = new FakeClient()
    await resolveV4PoolKeys(empty, [], new Map())
    assert.equal(empty.calls.length, 0)
  })

  test('loadBlockData survives malformed optional metadata and avoids Base calls on other chains', async () => {
    const swap = swapLog(POOL_ID, -1n, 1n)
    const raw: RawBlock = {
      number: '0x1', hash: '0x11', parentHash: '0x00', timestamp: '0x1', gasUsed: '0x0', gasLimit: '0x1',
      miner: CURRENCY1,
      transactions: [{ hash: swap.transactionHash, blockNumber: '0x1', transactionIndex: '0x0',
        from: CURRENCY1, to: UNI_V4_POOL_MANAGER_ADDRESS, value: '0x0', input: '0x', gas: '0x1' }],
    }
    for (const chainId of ['0x2105', '0x1']) {
      const client = scriptedClient(method => {
        if (method === 'eth_getBlockByNumber') return raw
        if (method === 'eth_getLogs') return [swap]
        if (method === 'eth_getBlockReceipts') return []
        if (method === 'eth_chainId') return chainId
        if (method === 'eth_call') return wordAt(encodeResult(FIXTURE_KEY), 2, 'g'.repeat(64))
        throw new Error(method)
      })
      const result = await loadBlockData(client as unknown as RpcClient, 1, new Map())
      assert.ok(result)
      assert.equal(result.newV4PoolKeys.size, 0)
      assert.equal(result.block.transactions[0].protocols[0].extra?.tokenIn, undefined)
      assert.equal(result.block.transactions[0].protocols[0].extra?.amount0, '-1')
      assert.deepEqual(client.calls.map(c => c.method), [
        'eth_getBlockByNumber', 'eth_getLogs', 'eth_getBlockReceipts', 'eth_chainId',
        ...(chainId === '0x2105' ? ['eth_call'] : []),
      ])
    }
  })
})

test('verification uses the full PoolId, not only the PositionManager bytes25 prefix', async () => {
  const samePrefixId = POOL_ID.slice(0, 52) + '00'.repeat(7)
  const client = new FakeClient(new Map([[POOL_ID, encodeResult(FIXTURE_KEY)]]))
  const result = await resolveV4PoolKeys(client, [swapLog(samePrefixId, -1n, 1n)], new Map())
  assert.equal(result.size, 0)
  assert.deepEqual(client.calls.map(c => c.method), ['eth_chainId', 'eth_call'])
})
