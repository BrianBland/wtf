import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ETH_NATIVE_ADDRESS, WETH_ADDRESS } from '../src/lib/protocols'

// tsx reads the root config (no JSX setting); supply its classic JSX runtime for SSR.
Object.defineProperty(globalThis, 'React', { configurable: true, value: React })
after(() => { Reflect.deleteProperty(globalThis, 'React') })
// The browser store registers a visibility listener at import time. SSR runs no effects.
Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener() {} } })
const { ProtocolEventList } = await import('../src/components/ValueFlow')
Reflect.deleteProperty(globalThis, 'document')

test('V4 UI explicitly labels unresolved currencies without inventing amounts', () => {
  const html = renderToStaticMarkup(createElement(ProtocolEventList, {
    events: [{ protocol: 'Uniswap V4', action: 'Swap', extra: { pool: '0x' + 'ab'.repeat(32), amount0: '-1', amount1: '2' } }],
  }))
  assert.match(html, /Currencies unresolved/)
  assert.match(html, /not inferred from singleton transfers/)
  assert.doesNotMatch(html, /Pool-level amounts/)
})

test('resolved V4 UI labels pool-level amounts and distinguishes hook-adjusted settlement', () => {
  const html = renderToStaticMarkup(createElement(ProtocolEventList, {
    events: [{ protocol: 'Uniswap V4', action: 'Swap', extra: {
      pool: '0x' + 'ab'.repeat(32), currency0: ETH_NATIVE_ADDRESS, currency1: WETH_ADDRESS,
      tokenIn: ETH_NATIVE_ADDRESS, tokenOut: WETH_ADDRESS, amountIn: '1000000000000000000', amountOut: '2000000000000000000',
    } }],
  }))
  assert.match(html, /Pool-level amounts/)
  assert.match(html, /not final user settlement; hooks and singleton netting/)
  assert.match(html, /1 ETH/)
  assert.match(html, /2 WETH/)
  assert.doesNotMatch(html, /Currencies unresolved/)
})
