import assert from 'node:assert/strict'
import { after, afterEach, describe, test } from 'node:test'
import React, { createElement } from 'react'
import { act, create as createTestRenderer } from 'react-test-renderer'
import { keccak_256 } from 'js-sha3'
import { buildHistograms } from '../src/lib/aggregations'
import { processBlock } from '../src/lib/blockProcessing'
import {
  B20_CREATED_TOPIC,
  B20_FACTORY_ADDRESS,
  detectB20Deployments,
  detectDeployments,
} from '../src/lib/deployments'
import { Log, RawBlock, RawReceipt, RawTransaction } from '../src/types'
import { encodeB20CreatedData, encodeB20StablecoinEventParams, wordAddress, wordUint } from './helpers'

const TX_HASH = `0x${'11'.repeat(32)}`
const OTHER_HASH = `0x${'22'.repeat(32)}`
const FROM = `0x${'33'.repeat(20)}`
const TO = `0x${'44'.repeat(20)}`
const CREATED = `0x${'55'.repeat(20)}`
const ASSET = '0xb20000000000000000000011223344556677abcd'
const STABLECOIN = '0xb20000000000000000000111223344556677cdef'

function rawTx(overrides: Partial<RawTransaction> = {}): RawTransaction {
  return {
    hash: TX_HASH,
    blockNumber: '0x1',
    transactionIndex: '0x0',
    from: FROM,
    to: B20_FACTORY_ADDRESS,
    value: '0x0',
    input: '0x',
    gas: '0x5208',
    ...overrides,
  }
}

function receipt(overrides: Partial<RawReceipt> = {}): RawReceipt {
  return { transactionHash: TX_HASH, gasUsed: '0x5208', status: '0x1', ...overrides }
}

function b20Log(
  variant: 0 | 1 = 0,
  address = variant === 0 ? ASSET : STABLECOIN,
  data = encodeB20CreatedData(
    variant === 0 ? 'Base Asset' : 'Base Dollar',
    variant === 0 ? 'BAS' : 'BUSD',
    variant === 0 ? 18 : 6,
    variant === 0 ? '0x' : encodeB20StablecoinEventParams('USD'),
  ),
): Log {
  return {
    address: B20_FACTORY_ADDRESS,
    topics: [B20_CREATED_TOPIC, `0x${wordAddress(address)}`, `0x${wordUint(BigInt(variant))}`],
    data,
    transactionHash: TX_HASH,
    logIndex: 0,
  }
}

function replaceWord(data: string, index: number, word: string): string {
  const start = 2 + index * 64
  return data.slice(0, start) + word + data.slice(start + 64)
}

function blockWith(tx: RawTransaction, logs: Log[], receipts: RawReceipt[] | null) {
  const raw: RawBlock = {
    number: '0x1',
    hash: OTHER_HASH,
    parentHash: `0x${'00'.repeat(32)}`,
    timestamp: '0x1',
    gasUsed: '0x5208',
    gasLimit: '0x100000',
    baseFeePerGas: '0x1',
    miner: TO,
    transactions: [tx],
  }
  const rawLogs = logs.map((log) => ({
    ...log,
    blockNumber: '0x1',
    blockHash: OTHER_HASH,
    transactionIndex: '0x0',
    logIndex: `0x${log.logIndex.toString(16)}`,
  }))
  return processBlock(raw, rawLogs, receipts)
}

test('official B20Created topic is independently verified from the canonical signature', () => {
  const signature = 'B20Created(address,uint8,string,string,uint8,bytes)'
  assert.equal(`0x${keccak_256(signature)}`, B20_CREATED_TOPIC)
})

test('accepts canonical Asset and Stablecoin events with event-provided metadata', () => {
  assert.deepEqual(detectB20Deployments([b20Log(0), b20Log(1)]), [
    {
      kind: 'b20', address: ASSET, source: 'b20-factory', variant: 'asset',
      name: 'Base Asset', symbol: 'BAS', decimals: 18,
    },
    {
      kind: 'b20', address: STABLECOIN, source: 'b20-factory', variant: 'stablecoin',
      name: 'Base Dollar', symbol: 'BUSD', decimals: 6,
    },
  ])
})

test('public detectors fail closed for malformed log containers and elements', () => {
  const malformed: unknown[] = [
    null,
    undefined,
    {},
    'logs',
    1,
    [null],
    [undefined],
    ['log'],
    [1],
    [{}],
    [{ address: B20_FACTORY_ADDRESS, topics: null, data: '0x' }],
    [{ address: B20_FACTORY_ADDRESS, topics: [B20_CREATED_TOPIC], data: null }],
  ]

  for (const input of malformed) {
    assert.doesNotThrow(() => detectB20Deployments(input))
    assert.deepEqual(detectB20Deployments(input), [])
    assert.doesNotThrow(() => detectDeployments(input, rawTx()))
    assert.deepEqual(detectDeployments(input, rawTx()), [])
  }
})

test('valid receipt-backed CREATE detection ignores missing or malformed gasUsed metadata', () => {
  for (const gasUsed of [undefined, 'not-hex', '0x05208']) {
    const rawReceipt = receipt({ gasUsed, contractAddress: CREATED })
    assert.deepEqual(detectDeployments([], rawTx({ to: null }), rawReceipt), [
      { kind: 'contract', address: CREATED, source: 'receipt' },
    ])
  }
})

describe('rejects noncanonical B20 emitter, topics, namespace, and variant', () => {
  const cases: [string, (log: Log) => void][] = [
    ['wrong emitter', (log) => { log.address = TO }],
    ['malformed emitter', (log) => { log.address = B20_FACTORY_ADDRESS.slice(0, -1) }],
    ['wrong topic0', (log) => { log.topics[0] = OTHER_HASH }],
    ['short topic0', (log) => { log.topics[0] = B20_CREATED_TOPIC.slice(0, -2) }],
    ['nonhex topic0', (log) => { log.topics[0] = `${B20_CREATED_TOPIC.slice(0, -1)}g` }],
    ['extra topic', (log) => { log.topics.push(OTHER_HASH) }],
    ['missing topic', (log) => { log.topics.pop() }],
    ['short address topic', (log) => { log.topics[1] = log.topics[1].slice(0, -2) }],
    ['nonhex address topic', (log) => { log.topics[1] = `${log.topics[1].slice(0, -1)}g` }],
    ['nonzero address padding', (log) => { log.topics[1] = `0x01${log.topics[1].slice(4)}` }],
    ['short variant topic', (log) => { log.topics[2] = log.topics[2].slice(0, -2) }],
    ['nonhex variant topic', (log) => { log.topics[2] = `${log.topics[2].slice(0, -1)}g` }],
    ['noncanonical uint8 padding', (log) => { log.topics[2] = `0x01${log.topics[2].slice(4)}` }],
    ['unknown uint8 variant', (log) => { log.topics[2] = `0x${wordUint(2n)}` }],
    ['namespace variant disagreement', (log) => { log.topics[1] = `0x${wordAddress(STABLECOIN)}` }],
    ['near namespace prefix', (log) => { log.topics[1] = `0x${wordAddress(`0xb300${ASSET.slice(6)}`)}` }],
  ]

  for (const [name, mutate] of cases) {
    test(name, () => {
      const log = b20Log(0)
      mutate(log)
      assert.deepEqual(detectB20Deployments([log]), [])
    })
  }
})

describe('validates variant-specific B20 event parameters', () => {
  const stableData = (params: string) => encodeB20CreatedData('Stable', 'ST', 6, params)
  const canonicalParams = encodeB20StablecoinEventParams('USD')

  test('Asset requires empty variantParams', () => {
    const data = encodeB20CreatedData('Asset', 'AST', 18, '0x01')
    assert.deepEqual(detectB20Deployments([b20Log(0, ASSET, data)]), [])
  })

  const malformed: [string, () => string][] = [
    ['empty Stablecoin params', () => '0x'],
    ['wrong outer tuple offset', () => replaceWord(canonicalParams, 0, wordUint(64n))],
    ['wrong version', () => replaceWord(canonicalParams, 1, wordUint(2n))],
    ['noncanonical uint8 version', () => replaceWord(canonicalParams, 1, wordUint(256n))],
    ['wrong currency offset', () => replaceWord(canonicalParams, 2, wordUint(96n))],
    ['out-of-bounds currency length', () => replaceWord(canonicalParams, 3, wordUint(1n << 255n))],
    ['fatal currency UTF-8', () => `${canonicalParams.slice(0, 2 + 4 * 64)}ff${canonicalParams.slice(2 + 4 * 64 + 2)}`],
    ['nonzero currency tail padding', () => `${canonicalParams.slice(0, 2 + 4 * 64 + 6)}01${canonicalParams.slice(2 + 4 * 64 + 8)}`],
    ['lowercase currency rejected by factory rules', () => encodeB20StablecoinEventParams('usd')],
    ['empty currency rejected by factory rules', () => encodeB20StablecoinEventParams('')],
    ['trailing word', () => `${canonicalParams}${'00'.repeat(32)}`],
  ]

  for (const [name, makeParams] of malformed) {
    test(name, () => {
      assert.deepEqual(detectB20Deployments([b20Log(1, STABLECOIN, stableData(makeParams()))]), [])
    })
  }
})

describe('rejects malformed and noncanonical B20 ABI data', () => {
  const canonical = encodeB20CreatedData('A', 'B', 18)
  const cases: [string, () => string][] = [
    ['nonhex', () => `${canonical.slice(0, -1)}g`],
    ['truncated word', () => canonical.slice(0, -2)],
    ['unaligned first offset', () => replaceWord(canonical, 0, wordUint(129n))],
    ['gap before first tail', () => replaceWord(canonical, 0, wordUint(160n))],
    ['aliased symbol offset', () => replaceWord(canonical, 1, wordUint(128n))],
    ['out-of-bounds symbol offset', () => replaceWord(canonical, 1, wordUint(1n << 255n))],
    ['aliased variantParams offset', () => replaceWord(canonical, 3, wordUint(128n))],
    ['out-of-bounds dynamic length', () => replaceWord(canonical, 4, wordUint(1n << 255n))],
    ['noncanonical uint8 word', () => replaceWord(canonical, 2, wordUint(256n))],
    ['nonzero string tail padding', () => `${canonical.slice(0, 2 + 5 * 64 + 2)}01${canonical.slice(2 + 5 * 64 + 4)}`],
    ['unconsumed trailing word', () => `${canonical}${'00'.repeat(32)}`],
    ['fatal UTF-8 name', () => `${canonical.slice(0, 2 + 5 * 64)}ff${canonical.slice(2 + 5 * 64 + 2)}`],
    ['fatal UTF-8 symbol', () => `${canonical.slice(0, 2 + 7 * 64)}ff${canonical.slice(2 + 7 * 64 + 2)}`],
    ['Asset decimals below range', () => replaceWord(canonical, 2, wordUint(5n))],
    ['Asset decimals above range', () => replaceWord(canonical, 2, wordUint(19n))],
  ]

  for (const [name, makeData] of cases) {
    test(name, () => assert.deepEqual(detectB20Deployments([b20Log(0, ASSET, makeData())]), []))
  }

  test('Stablecoin requires exactly 6 decimals', () => {
    assert.deepEqual(detectB20Deployments([
      b20Log(1, STABLECOIN, encodeB20CreatedData(
        'Stable', 'ST', 18, encodeB20StablecoinEventParams('USD'),
      )),
    ]), [])
  })
})

test('deduplicates addresses and lets canonical B20 evidence win a receipt collision', () => {
  const log = b20Log(0)
  assert.equal(detectB20Deployments([log, { ...log, logIndex: 1 }]).length, 1)

  const deployments = detectDeployments(
    [log, { ...log, logIndex: 1 }],
    rawTx({ to: null }),
    receipt({ contractAddress: ASSET.toUpperCase() }),
  )
  assert.deepEqual(deployments, [{
    kind: 'b20', address: ASSET, source: 'b20-factory', variant: 'asset',
    name: 'Base Asset', symbol: 'BAS', decimals: 18,
  }])
})

describe('receipt-backed top-level contract deployment conditions', () => {
  test('accepts only matching successful CREATE and normalizes the address', () => {
    assert.deepEqual(detectDeployments([], rawTx({ to: null }), receipt({ contractAddress: CREATED.toUpperCase() })), [
      { kind: 'contract', address: CREATED, source: 'receipt' },
    ])
  })

  const rejected: [string, RawTransaction, RawReceipt | undefined][] = [
    ['missing receipt', rawTx({ to: null }), undefined],
    ['missing status', rawTx({ to: null }), receipt({ status: undefined, contractAddress: CREATED })],
    ['failed status', rawTx({ to: null }), receipt({ status: '0x0', contractAddress: CREATED })],
    ['malformed status', rawTx({ to: null }), receipt({ status: '0x01', contractAddress: CREATED })],
    ['missing address', rawTx({ to: null }), receipt({ contractAddress: undefined })],
    ['null address', rawTx({ to: null }), receipt({ contractAddress: null })],
    ['malformed address', rawTx({ to: null }), receipt({ contractAddress: CREATED.slice(0, -1) })],
    ['ordinary call', rawTx({ to: TO }), receipt({ contractAddress: CREATED })],
    ['mismatched hash', rawTx({ to: null }), receipt({ transactionHash: OTHER_HASH, contractAddress: CREATED })],
    ['malformed receipt hash', rawTx({ to: null }), receipt({ transactionHash: '0x1', contractAddress: CREATED })],
  ]
  for (const [name, tx, rawReceipt] of rejected) {
    test(name, () => assert.deepEqual(detectDeployments([], tx, rawReceipt), []))
  }
})

test('B20 logs remain proof without block receipts and are suppressed only by a matching explicit failure', () => {
  const log = b20Log(0)
  assert.equal(detectDeployments([log], rawTx(), undefined).length, 1)
  assert.equal(detectDeployments([log], rawTx(), receipt({ status: 'garbage' })).length, 1)
  assert.equal(detectDeployments([log], rawTx(), receipt({ transactionHash: OTHER_HASH, status: '0x0' })).length, 1)
  assert.deepEqual(detectDeployments([log], rawTx(), receipt({ status: '0x0' })), [])
})

test('processBlock attaches deployments without protocol histogram pollution and preserves ordinary/revert behavior', () => {
  const createBlock = blockWith(rawTx({ to: null }), [], [receipt({ contractAddress: CREATED })])
  const createTx = createBlock.transactions[0]
  assert.deepEqual(createTx.deployments, [{ kind: 'contract', address: CREATED, source: 'receipt' }])
  assert.deepEqual(createTx.protocols, [])
  assert.deepEqual(buildHistograms([createBlock]).protocols, [])

  const malformedGasBlock = blockWith(
    rawTx({ to: null }),
    [],
    [receipt({ gasUsed: 'not-hex', contractAddress: CREATED })],
  )
  assert.deepEqual(malformedGasBlock.transactions[0].deployments, [
    { kind: 'contract', address: CREATED, source: 'receipt' },
  ])
  assert.equal(malformedGasBlock.transactions[0].gasUsed, undefined)

  const ordinaryBlock = blockWith(rawTx({ to: TO }), [], [receipt({ contractAddress: CREATED })])
  assert.deepEqual(ordinaryBlock.transactions[0].deployments, [])
  assert.equal(ordinaryBlock.transactions[0].to, TO)

  const failedBlock = blockWith(rawTx({ to: null }), [], [receipt({ status: '0x0', contractAddress: CREATED })])
  assert.equal(failedBlock.transactions[0].reverted, true)
  assert.deepEqual(failedBlock.transactions[0].deployments, [])
})

test('processBlock keeps canonical B20 evidence when receipts are unavailable and drops it on explicit failure', () => {
  const withoutReceipts = blockWith(rawTx(), [b20Log(0)], null)
  assert.equal(withoutReceipts.transactions[0].deployments[0]?.kind, 'b20')
  assert.deepEqual(withoutReceipts.transactions[0].protocols, [])
  assert.deepEqual(buildHistograms([withoutReceipts]).protocols, [])

  const failed = blockWith(rawTx(), [b20Log(0)], [receipt({ status: '0x0' })])
  assert.deepEqual(failed.transactions[0].deployments, [])
})

// Browser components register a document listener through the store at import time.
Object.defineProperty(globalThis, 'React', { configurable: true, value: React })
Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener() {} } })
const [{ TxView }, { useStore }] = await Promise.all([
  import('../src/components/TxView'),
  import('../src/store'),
])
Reflect.deleteProperty(globalThis, 'document')
after(() => { Reflect.deleteProperty(globalThis, 'React') })
afterEach(() => { useStore.setState({ blocks: new Map(), tokenCache: new Map() }) })

test('TxView surfaces the actual created address and B20 event metadata without metadata fetches', () => {
  const logs = [b20Log(0)]
  const block = blockWith(rawTx({ to: null }), logs, [receipt({ contractAddress: CREATED })])
  const originalFetchToken = useStore.getState().fetchToken
  let fetchCalls = 0
  useStore.setState({
    blocks: new Map([[block.number, block]]),
    fetchToken: () => { fetchCalls += 1 },
  })

  let renderer!: ReturnType<typeof createTestRenderer>
  try {
    act(() => { renderer = createTestRenderer(createElement(TxView, { txHash: TX_HASH, blockNumber: 1 })) })
    const output = JSON.stringify(renderer.toJSON())
    assert.match(output, new RegExp(CREATED))
    assert.match(output, /Contract Created/)
    assert.match(output, /Base Asset/)
    assert.match(output, /BAS/)
    assert.match(output, /18 decimals/)
    assert.doesNotMatch(output, /No token or ETH flows detected/)
    assert.equal(fetchCalls, 0)
  } finally {
    act(() => { renderer?.unmount() })
    useStore.setState({ fetchToken: originalFetchToken })
  }
})

test('TxView labels failed and receipt-unavailable CREATE intent without claiming success', () => {
  const cases = [
    { block: blockWith(rawTx({ to: null }), [], [receipt({ status: '0x0', contractAddress: CREATED })]), label: 'contract creation failed' },
    { block: blockWith(rawTx({ to: null }), [], null), label: 'contract creation unconfirmed' },
  ]

  for (const { block, label } of cases) {
    useStore.setState({ blocks: new Map([[block.number, block]]) })
    let renderer!: ReturnType<typeof createTestRenderer>
    try {
      act(() => { renderer = createTestRenderer(createElement(TxView, { txHash: TX_HASH, blockNumber: 1 })) })
      const output = JSON.stringify(renderer.toJSON())
      assert.match(output, new RegExp(label))
      assert.doesNotMatch(output, /Contract Created/)
      assert.doesNotMatch(output, new RegExp(CREATED))
    } finally {
      act(() => { renderer?.unmount() })
    }
  }
})
