import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import React, { createElement } from 'react'
import { act, create as createTestRenderer } from 'react-test-renderer'
import type { Block } from '../src/types'
import type { PoolMeta } from '../src/lib/poolFetch'
import type { RpcClient } from '../src/lib/rpc'

Object.defineProperty(globalThis, 'React', { configurable: true, value: React })
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { addEventListener() {}, visibilityState: 'visible' },
})
const [{ useStore }, { ProtocolDrillDown }] = await Promise.all([
  import('../src/store'),
  import('../src/components/ProtocolDrillDown'),
])
Reflect.deleteProperty(globalThis, 'document')
after(() => { Reflect.deleteProperty(globalThis, 'React') })

const POOL = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN0 = '0x1111111111111111111111111111111111111111'
const TOKEN1 = '0x2222222222222222222222222222222222222222'
const FACTORY = '0x33128a8fc17869897dce68ed026d694621f6fdfd'
const UI_META: PoolMeta = {
  token0: TOKEN0,
  token1: TOKEN1,
  factory: FACTORY,
  protocol: 'Uniswap V3',
}
const BLOCK_META: PoolMeta = {
  token0: '0x3333333333333333333333333333333333333333',
  token1: '0x4444444444444444444444444444444444444444',
  factory: '0x9999999999999999999999999999999999999999',
  protocol: 'Unknown',
}

interface PendingCall {
  params: unknown[]
  resolve: (value: string) => void
  reject: (error: Error) => void
}

function addressWord(address: string): string {
  return `0x${address.slice(2).padStart(64, '0')}`
}

function responseFor(params: unknown[]): string {
  const selector = (params[0] as { data: string }).data
  if (selector === '0x0dfe1681') return addressWord(UI_META.token0)
  if (selector === '0xd21220a7') return addressWord(UI_META.token1)
  if (selector === '0xc45a0155') return addressWord(UI_META.factory)
  throw new Error(`Unexpected selector ${selector}`)
}

function controlledClient(): { client: RpcClient; calls: PendingCall[] } {
  const calls: PendingCall[] = []
  const client = {
    call(_method: string, params: unknown[]) {
      return new Promise<string>((resolve, reject) => calls.push({ params, resolve, reject }))
    },
  } as unknown as RpcClient
  return { client, calls }
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

const originalFetchPool = useStore.getState().fetchPool
afterEach(() => {
  useStore.setState({
    client: null,
    poolCache: new Map(),
    tokenCache: new Map(),
    fetchPool: originalFetchPool,
  })
})

test('a pool metadata success from an old client cannot populate a fresh client cache', async () => {
  const old = controlledClient()
  const freshClient = {} as RpcClient
  useStore.setState({ client: old.client, poolCache: new Map() })

  useStore.getState().fetchPool(POOL)
  assert.equal(useStore.getState().poolCache.get(POOL), 'loading')
  assert.equal(old.calls.length, 3)

  useStore.setState({ client: freshClient, poolCache: new Map() })
  for (const call of old.calls) call.resolve(responseFor(call.params))
  await flushPromises()

  assert.equal(useStore.getState().client, freshClient)
  assert.equal(useStore.getState().poolCache.has(POOL), false)
})

test('late UI success or failure cannot overwrite newer block-applied pool metadata', async () => {
  for (const outcome of ['success', 'failure'] as const) {
    const pending = controlledClient()
    useStore.setState({ client: pending.client, poolCache: new Map() })
    useStore.getState().fetchPool(POOL)
    assert.equal(useStore.getState().poolCache.get(POOL), 'loading')

    useStore.setState({ poolCache: new Map([[POOL, BLOCK_META]]) })
    for (const call of pending.calls) {
      if (outcome === 'success') call.resolve(responseFor(call.params))
      else call.reject(new Error('late UI RPC failure'))
    }
    await flushPromises()

    assert.deepEqual(useStore.getState().poolCache.get(POOL), BLOCK_META)
  }
})

function drillDownBlock(): Block {
  return {
    number: 1,
    hash: '0xblock',
    parentHash: '0xparent',
    timestamp: 1,
    gasUsed: 0n,
    gasLimit: 1n,
    baseFeePerGas: 0n,
    miner: TOKEN0,
    transactions: [{
      hash: '0xtx',
      blockNumber: 1,
      index: 0,
      from: TOKEN0,
      to: POOL,
      value: 0n,
      gas: 1n,
      input: '0x',
      logs: [],
      tokenFlows: [],
      ethFlows: [],
      protocols: [{ protocol: 'Unknown CL', action: 'Swap', extra: { pool: POOL } }],
    }],
  } as Block
}

test('pool metadata errors expose one click-driven retry without a render retry loop', async () => {
  const pending = controlledClient()
  let stopped = 0
  useStore.setState({
    client: pending.client,
    poolCache: new Map([[POOL, 'error']]),
    fetchPool: originalFetchPool,
  })

  let renderer!: ReturnType<typeof createTestRenderer>
  try {
    act(() => {
      renderer = createTestRenderer(createElement(ProtocolDrillDown, {
        blocks: [drillDownBlock()],
        onSelectTx() {},
      }))
    })
    assert.equal(pending.calls.length, 0)

    const label = `Retry metadata for ${POOL}`
    const retryButtons = renderer.root.findAllByProps({ 'aria-label': label })
    assert.equal(retryButtons.length, 1)
    act(() => {
      retryButtons[0].props.onClick({ stopPropagation: () => { stopped++ } })
    })

    assert.equal(stopped, 1)
    assert.equal(pending.calls.length, 3)
    assert.equal(useStore.getState().poolCache.get(POOL), 'loading')
    assert.equal(renderer.root.findAllByProps({ 'aria-label': label }).length, 0)
    act(() => { renderer.update(createElement(ProtocolDrillDown, {
      blocks: [drillDownBlock()],
      onSelectTx() {},
    })) })
    assert.equal(pending.calls.length, 3)

    await act(async () => {
      for (const call of pending.calls) call.reject(new Error('retry failed'))
      await flushPromises()
    })
    assert.equal(useStore.getState().poolCache.get(POOL), 'error')
    assert.equal(renderer.root.findAllByProps({ 'aria-label': label }).length, 1)
    assert.equal(pending.calls.length, 3)
  } finally {
    act(() => { renderer?.unmount() })
  }
})
