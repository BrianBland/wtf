import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Block, Transaction } from '../src/types'

Object.defineProperty(globalThis, 'React', { configurable: true, value: React })
Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener() {} } })
const [{ ProtocolDrillDown }, { useStore }] = await Promise.all([
  import('../src/components/ProtocolDrillDown'),
  import('../src/store'),
])
Reflect.deleteProperty(globalThis, 'document')
after(() => { Reflect.deleteProperty(globalThis, 'React') })

const POOL = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function blockWithUnresolvedSwap(): Block[] {
  const tx = {
    hash: '0xtest',
    tokenFlows: [],
    protocols: [{ protocol: 'Uniswap V3', action: 'Swap', extra: {
      pool: POOL,
      swapType: 'v3',
      volumeDataValid: true,
      amount0: '1000',
      amount1: '-1',
    } }],
  } as unknown as Transaction
  return [{ transactions: [tx] } as unknown as Block]
}

test('pool rows render an explicit incomplete-volume indicator', () => {
  useStore.setState({ poolCache: new Map(), tokenCache: new Map() })
  const html = renderToStaticMarkup(createElement(ProtocolDrillDown, {
    blocks: blockWithUnresolvedSwap(),
    onSelectTx: () => {},
  }))
  assert.match(html, />volume incomplete</)
  assert.match(html, /Per-pool volume incomplete: swap metadata or event data unresolved/)
})
