import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create as createTestRenderer } from 'react-test-renderer'
import {
  classifyB20Address,
  getB20AddressBadgeMetadata,
} from '../src/lib/b20'
import { shortAddr } from '../src/lib/formatters'
import { KNOWN_PROTOCOLS, KNOWN_TOKENS } from '../src/lib/protocols'

// Browser components register a document listener through the store at import time.
// SSR itself runs no effects and performs no metadata RPC calls.
Object.defineProperty(globalThis, 'React', { configurable: true, value: React })
Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener() {} } })
const [{ HexTag, TokenBadge }, { Histogram }, { useStore }, { TokenFlowBadges }] = await Promise.all([
  import('../src/components/HexTag'),
  import('../src/components/Histogram'),
  import('../src/store'),
  import('../src/components/BlockView'),
])
Reflect.deleteProperty(globalThis, 'document')
after(() => { Reflect.deleteProperty(globalThis, 'React') })

const ASSET = '0xb20000000000000000000011223344556677abcd'
const STABLECOIN = '0xb20000000000000000000111223344556677cdef'

function markup(component: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(component)
}

afterEach(() => {
  useStore.setState({ tokenCache: new Map() })
})

test('classifies only exact 20-byte B20 addresses and known variants', () => {
  assert.equal(classifyB20Address(ASSET), 'asset')
  assert.equal(classifyB20Address(STABLECOIN.toUpperCase()), 'stablecoin')

  const falsePositives = [
    // Unknown variant byte.
    '0xb20000000000000000000211223344556677abcd',
    // Near-prefix and factory-like addresses do not receive prefix-only matches.
    '0xb30000000000000000000011223344556677abcd',
    '0xb20f00000000000000000011223344556677abcd',
    '0xb20000000000000001000011223344556677abcd',
    // Missing prefix, wrong byte length, non-hex, and a hash-shaped value.
    ASSET.slice(2),
    ASSET.slice(0, -1),
    `${ASSET.slice(0, -1)}g`,
    `${ASSET}${'00'.repeat(12)}`,
  ]
  for (const value of falsePositives) assert.equal(classifyB20Address(value), null, value)
})

test('central metadata normalizes the placeholder, title, and stable type colors', () => {
  const asset = getB20AddressBadgeMetadata(ASSET.toUpperCase())
  const stablecoin = getB20AddressBadgeMetadata(STABLECOIN)

  assert.deepEqual(asset, {
    type: 'asset',
    typeLabel: 'B20 Asset',
    label: '…abcd',
    address: ASSET,
    title: `B20 Asset · ${ASSET}`,
    backgroundColor: '#1d4ed8',
    color: '#ffffff',
    borderColor: '#60a5fa',
  })
  assert.equal(stablecoin?.label, '…cdef')
  assert.equal(stablecoin?.title, `B20 Stablecoin · ${STABLECOIN}`)
  assert.equal(stablecoin?.backgroundColor, '#047857')
  assert.notEqual(stablecoin?.backgroundColor, asset?.backgroundColor)
})

test('shortAddr uses last-four B20 placeholders without changing ordinary values', () => {
  assert.equal(shortAddr(ASSET), '…abcd')
  assert.equal(shortAddr(ASSET.toUpperCase(), 3), '…abcd')
  assert.equal(shortAddr('0x1234567890abcdef1234567890abcdef12345678', 3), '0x123…678')
  assert.equal(shortAddr(`${ASSET}${'00'.repeat(12)}`, 3), '0xb20…000')
})

test('HexTag SSR applies B20 placeholder, semantic type style, title, and overrides', () => {
  const asset = markup(createElement(HexTag, { value: ASSET, type: 'address' }))
  assert.match(asset, />…abcd<\/span>/)
  assert.match(asset, /b20-tag b20-asset/)
  assert.match(asset, /background-color:#1d4ed8/)
  assert.match(asset, new RegExp(`title="B20 Asset · ${ASSET}"`))
  assert.match(asset, new RegExp(`aria-label="B20 Asset · ${ASSET}"`))

  // Explicit labels win. Explicit titles are retained while mandatory B20 identity
  // and the full address are appended. Explicit muted styling remains neutral.
  const overridden = markup(createElement(HexTag, {
    value: STABLECOIN,
    type: 'address',
    label: 'custom',
    title: 'Provided title',
    muted: true,
  }))
  assert.match(overridden, />custom<\/span>/)
  assert.match(overridden, /background-color:var\(--surface3\)/)
  assert.match(overridden, new RegExp(`title="Provided title · B20 Stablecoin · ${STABLECOIN}"`))
})

test('known labels take precedence over B20 placeholders without changing B20 presentation', () => {
  const previousToken = KNOWN_TOKENS[ASSET]
  const previousProtocol = KNOWN_PROTOCOLS[STABLECOIN]
  KNOWN_TOKENS[ASSET] = { symbol: 'B20K', decimals: 18, color: '#123456' }
  KNOWN_PROTOCOLS[STABLECOIN] = { name: 'B20 Protocol', type: 'other' }

  try {
    const tokenHexTag = markup(createElement(HexTag, { value: ASSET.toUpperCase(), type: 'address' }))
    assert.match(tokenHexTag, />B20K<\/span>/)
    assert.match(tokenHexTag, /b20-tag b20-asset/)
    assert.match(tokenHexTag, /background-color:#1d4ed8/)

    const protocolHexTag = markup(createElement(HexTag, { value: STABLECOIN.toUpperCase(), type: 'address' }))
    assert.match(protocolHexTag, />B20 Protocol<\/span>/)
    assert.match(protocolHexTag, /b20-tag b20-stablecoin/)

    const histogram = markup(createElement(Histogram, {
      entries: [
        { key: ASSET.toUpperCase(), count: 2, gas: 3 },
        { key: STABLECOIN.toUpperCase(), count: 1, gas: 2 },
      ],
      type: 'address',
    }))
    assert.match(histogram, />B20K<\/span>/)
    assert.match(histogram, />B20 Protocol<\/span>/)
    assert.match(histogram, /b20-row b20-asset/)
    assert.match(histogram, /b20-row b20-stablecoin/)
  } finally {
    if (previousToken) KNOWN_TOKENS[ASSET] = previousToken
    else delete KNOWN_TOKENS[ASSET]
    if (previousProtocol) KNOWN_PROTOCOLS[STABLECOIN] = previousProtocol
    else delete KNOWN_PROTOCOLS[STABLECOIN]
  }
})

test('TokenBadge preserves original address casing while using normalized metadata keys', () => {
  const originalAddress = ASSET.toUpperCase()
  useStore.setState({
    tokenCache: new Map([[ASSET, {
      symbol: 'COIN',
      name: 'Example Coin',
      decimals: 18,
      isNFT: false,
    }]]),
  })

  const dynamicElement = TokenBadge({ address: originalAddress }) as React.ReactElement<{
    address: string
    normalizedAddress: string
  }>
  assert.equal(dynamicElement.props.address, originalAddress)
  assert.equal(dynamicElement.props.normalizedAddress, ASSET)

  const resolved = markup(createElement(TokenBadge, { address: originalAddress }))
  assert.match(resolved, />COIN<\/span>/)
  assert.match(resolved, /b20-tag b20-asset/)
  assert.ok(resolved.includes(`title="Example Coin · ${originalAddress} · 18 decimals · B20 Asset · ${ASSET}"`))

  useStore.setState({ tokenCache: new Map() })
  const unresolved = markup(createElement(TokenBadge, { address: STABLECOIN }))
  assert.match(unresolved, />…cdef<\/span>/)
  assert.match(unresolved, /b20-tag b20-stablecoin/)
  assert.match(unresolved, new RegExp(`title="B20 Stablecoin · ${STABLECOIN}"`))
})

test('static-known B20 TokenBadge preserves the original value passed to clickable HexTag', () => {
  const previous = KNOWN_TOKENS[ASSET]
  const originalAddress = ASSET.toUpperCase()
  KNOWN_TOKENS[ASSET] = { symbol: 'B20K', decimals: 18, color: '#123456' }

  try {
    const element = TokenBadge({ address: originalAddress }) as React.ReactElement<{ value: string }>
    assert.equal(element.type, HexTag)
    assert.equal(element.props.value, originalAddress)

    const output = markup(element)
    assert.match(output, />B20K<\/span>/)
    assert.match(output, /b20-tag b20-asset/)
    assert.match(output, new RegExp(`title="B20 Asset · ${ASSET}"`))
  } finally {
    if (previous) KNOWN_TOKENS[ASSET] = previous
    else delete KNOWN_TOKENS[ASSET]
  }
})

test('address Histogram uses B20 label, type color, and full type-aware titles', () => {
  const output = markup(createElement(Histogram, {
    entries: [{ key: STABLECOIN, count: 2, gas: 3 }],
    type: 'address',
  }))

  assert.match(output, /hist-row b20-row b20-stablecoin/)
  assert.match(output, /background:#047857/)
  assert.match(output, />…cdef<\/span>/)
  assert.match(output, new RegExp(`title="B20 Stablecoin · ${STABLECOIN}"`))
  assert.ok(output.includes(`title="B20 Stablecoin · ${STABLECOIN} (click to copy)"`))
})

test('transaction-row B20 badges do not fetch metadata and react to cached symbols', () => {
  const ordinary = '0x1234567890abcdef1234567890abcdef12345678'
  const tokenFlows = [
    { token: ASSET, from: ordinary, to: STABLECOIN, amount: 1n },
    { token: ordinary, from: ASSET, to: STABLECOIN, amount: 2n },
  ]
  const originalFetchToken = useStore.getState().fetchToken
  let fetchCalls = 0
  useStore.setState({ fetchToken: () => { fetchCalls += 1 } })

  let renderer!: ReturnType<typeof createTestRenderer>
  try {
    act(() => { renderer = createTestRenderer(createElement(TokenFlowBadges, { tokenFlows })) })
    const unresolved = JSON.stringify(renderer.toJSON())
    assert.match(unresolved, /b20-tag b20-asset/)
    assert.match(unresolved, /…abcd/)
    assert.match(unresolved, /badge cyan/)
    assert.match(unresolved, /1234/)
    assert.equal(fetchCalls, 0)

    act(() => {
      useStore.setState({
        tokenCache: new Map([[ASSET, {
          symbol: 'B20C', name: 'Cached B20', decimals: 18, isNFT: false,
        }]]),
      })
    })
    const cached = JSON.stringify(renderer.toJSON())
    assert.match(cached, /b20-tag b20-asset/)
    assert.match(cached, /B20C/)
    assert.equal(fetchCalls, 0)
  } finally {
    act(() => { renderer?.unmount() })
    useStore.setState({ fetchToken: originalFetchToken })
  }
})
