import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchPoolMeta, isPoolAddress } from '../src/lib/poolFetch'
import { fetchV3PoolProtocols } from '../src/lib/logProcessing'
import { loadBlockData } from '../src/lib/blockProcessing'
import { AMM_SWAP_TOPIC } from '../src/lib/protocols'
import { RpcClient } from '../src/lib/rpc'
import type { RawBlock, RawLog } from '../src/types'

const POOL = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN0 = '0x1111111111111111111111111111111111111111'
const TOKEN1 = '0x2222222222222222222222222222222222222222'
const KNOWN_FACTORY = '0x33128a8fc17869897dce68ed026d694621f6fdfd'
const UNKNOWN_FACTORY = '0x9999999999999999999999999999999999999999'

function addressWord(address: string): string {
  return `0x${address.slice(2).padStart(64, '0')}`
}

function responseFor(params: unknown[], factory = KNOWN_FACTORY): string {
  const data = (params[0] as { data: string }).data
  if (data === '0x0dfe1681') return addressWord(TOKEN0)
  if (data === '0xd21220a7') return addressWord(TOKEN1)
  if (data === '0xc45a0155') return addressWord(factory)
  throw new Error(`Unexpected selector ${data}`)
}

function clientFrom(call: (method: string, params: unknown[]) => Promise<unknown>): RpcClient {
  return { call } as unknown as RpcClient
}

function poolLog(blockNumber = '0x2a'): RawLog {
  return {
    address: POOL,
    topics: [AMM_SWAP_TOPIC],
    data: '0x',
    blockNumber,
    blockHash: '0x' + '11'.repeat(32),
    transactionHash: '0x' + '22'.repeat(32),
    transactionIndex: '0x0',
    logIndex: '0x0',
  }
}

test('address-only fetchPoolMeta never sends bytes32 PoolIds or malformed addresses to eth_call.to', async () => {
  const calls: unknown[] = []
  const client = clientFrom(async (method, params) => {
    calls.push({ method, params })
    return responseFor(params)
  })
  for (const address of ['0x' + 'ab'.repeat(32), '0x' + 'gg'.repeat(20), 'ab'.repeat(21), '0x1', '']) {
    assert.equal(isPoolAddress(address), false)
    await assert.rejects(fetchPoolMeta(client, address), /20-byte address/)
  }
  assert.equal(calls.length, 0)

  const address = '0x' + 'AB'.repeat(20)
  assert.equal(isPoolAddress(address), true)
  await fetchPoolMeta(client, address)
  assert.equal(calls.length, 3)
  for (const call of calls as Array<{ params: Array<{ to: string }> }>) {
    assert.equal(call.params[0].to, address.toLowerCase())
  }
})

test('uses the explicit block tag for all calls and defaults UI-style requests to latest', async () => {
  const tags: unknown[] = []
  const client = clientFrom(async (_method, params) => {
    tags.push(params[1])
    return responseFor(params)
  })

  await fetchPoolMeta(client, POOL, '0xabc')
  await fetchPoolMeta(client, POOL)
  assert.deepEqual(tags, ['0xabc', '0xabc', '0xabc', 'latest', 'latest', 'latest'])
})

test('strictly validates padding, width, and hex for all three address ABI words', async () => {
  const malformed = [
    '0x',
    `0x${'1'.repeat(63)}`,
    `0x${'1'.repeat(65)}`,
    `0x${'g'.repeat(64)}`,
    `0x01${'0'.repeat(62)}`,
    addressWord(TOKEN0).toUpperCase(),
  ]
  const fields = [
    ['0x0dfe1681', 'token0'],
    ['0xd21220a7', 'token1'],
    ['0xc45a0155', 'factory'],
  ] as const

  for (const [selector, field] of fields) {
    for (const bad of malformed) {
      const client = clientFrom(async (_method, params) => {
        const data = (params[0] as { data: string }).data
        return data === selector ? bad : responseFor(params)
      })
      await assert.rejects(fetchPoolMeta(client, POOL, '0x1'), new RegExp(`Malformed ${field} response`))
    }
  }
})

test('rejects transport and partial metadata failures instead of returning Unknown', async () => {
  let callCount = 0
  const client = clientFrom(async (_method, params) => {
    callCount++
    if ((params[0] as { data: string }).data === '0xc45a0155') throw new Error('temporary RPC failure')
    return responseFor(params)
  })

  await assert.rejects(fetchPoolMeta(client, POOL, '0x10'), /temporary RPC failure/)
  assert.equal(callCount, 3)
})

test('rejects zero token/factory addresses and identical token pairs after canonical decoding', async () => {
  const zero = '0x0000000000000000000000000000000000000000'
  const cases = [
    { selector: '0x0dfe1681', address: zero, message: /token0 is the zero address/ },
    { selector: '0xd21220a7', address: zero, message: /token1 is the zero address/ },
    { selector: '0xc45a0155', address: zero, message: /factory is the zero address/ },
    { selector: '0xd21220a7', address: TOKEN0, message: /token0 and token1 are identical/ },
  ]

  for (const { selector, address, message } of cases) {
    const client = clientFrom(async (_method, params) => {
      const data = (params[0] as { data: string }).data
      return data === selector ? addressWord(address) : responseFor(params)
    })
    await assert.rejects(fetchPoolMeta(client, POOL, '0x20'), message)
  }
})

test('a valid nonzero but unregistered factory resolves to cacheable Unknown metadata', async () => {
  const client = clientFrom(async (_method, params) => responseFor(params, UNKNOWN_FACTORY))
  const meta = await fetchPoolMeta(client, POOL, '0x21')
  assert.deepEqual(meta, {
    token0: TOKEN0,
    token1: TOKEN1,
    factory: UNKNOWN_FACTORY,
    protocol: 'Unknown',
  })
})

test('bounds eth_call concurrency to four across overlapping resolver invocations', async () => {
  let active = 0
  let maxActive = 0
  let callCount = 0
  const client = clientFrom(async (_method, params) => {
    callCount++
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active--
    return responseFor(params)
  })

  await Promise.all(Array.from({ length: 6 }, (_, i) => (
    fetchPoolMeta(client, `0x${(i + 1).toString(16).padStart(40, '0')}`, '0x30')
  )))
  assert.equal(callCount, 18)
  assert.equal(maxActive, 4)
})

test('deduplicates the same client, pool, and block request while it is in flight', async () => {
  let callCount = 0
  const client = clientFrom(async (_method, params) => {
    callCount++
    await new Promise((resolve) => setTimeout(resolve, 5))
    return responseFor(params)
  })

  const results = await Promise.all([
    fetchPoolMeta(client, POOL, '0x40'),
    fetchPoolMeta(client, POOL.toUpperCase().replace('0X', '0x'), '0x40'),
    fetchPoolMeta(client, POOL, '0x40'),
  ])
  assert.equal(callCount, 3)
  assert.deepEqual(results[0], results[1])
  assert.deepEqual(results[1], results[2])
})

test('does not deduplicate across clients or historical block tags', async () => {
  let firstCalls = 0
  let secondCalls = 0
  const first = clientFrom(async (_method, params) => {
    firstCalls++
    await new Promise((resolve) => setTimeout(resolve, 2))
    return responseFor(params)
  })
  const second = clientFrom(async (_method, params) => {
    secondCalls++
    return responseFor(params)
  })

  await Promise.all([
    fetchPoolMeta(first, POOL, '0x50'),
    fetchPoolMeta(first, POOL, '0x51'),
    fetchPoolMeta(second, POOL, '0x50'),
  ])
  assert.equal(firstCalls, 6)
  assert.equal(secondCalls, 3)
})

test('failed in-flight requests are cleaned up, reject every waiter, and can retry without unhandled rejection', async () => {
  let shouldFail = true
  let callCount = 0
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    const client = clientFrom(async (_method, params) => {
      callCount++
      if (shouldFail) throw new Error('RPC unavailable')
      return responseFor(params)
    })

    const first = await Promise.allSettled([
      fetchPoolMeta(client, POOL, '0x60'),
      fetchPoolMeta(client, POOL, '0x60'),
    ])
    assert.deepEqual(first.map((result) => result.status), ['rejected', 'rejected'])
    assert.equal(callCount, 3)

    shouldFail = false
    const retried = await fetchPoolMeta(client, POOL, '0x60')
    assert.equal(retried.protocol, 'Uniswap V3')
    assert.equal(callCount, 6)
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(unhandled, [])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('block-driven resolution retries poolCache error entries at the requested block', async () => {
  const tags: unknown[] = []
  const client = clientFrom(async (_method, params) => {
    tags.push(params[1])
    return responseFor(params)
  })
  const cache = new Map<string, 'error'>([[POOL, 'error']])

  const result = await fetchV3PoolProtocols(client, [poolLog('0x70')], cache, '0x70')
  assert.equal(result.newMeta.get(POOL)?.protocol, 'Uniswap V3')
  assert.equal(result.protocols.get(POOL), 'Uniswap V3')
  assert.deepEqual(tags, ['0x70', '0x70', '0x70'])
})

test('loadBlockData pins pool calls to the event block and survives optional metadata failure', async () => {
  const rawBlock: RawBlock = {
    number: '0x2a',
    hash: '0x' + '33'.repeat(32),
    parentHash: '0x' + '44'.repeat(32),
    timestamp: '0x1',
    gasUsed: '0x0',
    gasLimit: '0x1',
    miner: TOKEN0,
    transactions: [],
  }
  const ethCallTags: unknown[] = []
  const client = clientFrom(async (method, params) => {
    if (method === 'eth_getBlockByNumber') return rawBlock
    if (method === 'eth_getLogs') return [poolLog()]
    if (method === 'eth_getBlockReceipts') return []
    if (method === 'eth_call') {
      ethCallTags.push(params[1])
      throw new Error('archive node temporarily unavailable')
    }
    throw new Error(`Unexpected method ${method}`)
  })

  const loaded = await loadBlockData(client, 42, new Map())
  assert.ok(loaded)
  assert.equal(loaded.block.number, 42)
  assert.equal(loaded.newMeta.size, 0)
  assert.deepEqual(ethCallTags, ['0x2a', '0x2a', '0x2a'])
})
