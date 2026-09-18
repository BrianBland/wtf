import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchPoolMeta, isPoolAddress } from '../src/lib/poolFetch'
import { RpcClient } from '../src/lib/rpc'

test('address-only fetchPoolMeta never sends bytes32 PoolIds or malformed addresses to eth_call.to', async () => {
  const calls: unknown[] = []
  const client = { async call(method: string, params: unknown[]) { calls.push({ method, params }); return '0x' } }
  for (const address of ['0x' + 'ab'.repeat(32), '0x' + 'gg'.repeat(20), 'ab'.repeat(21), '0x1', '']) {
    assert.equal(isPoolAddress(address), false)
    await assert.rejects(fetchPoolMeta(client as unknown as RpcClient, address), /20-byte address/)
  }
  assert.equal(calls.length, 0)
  const address = '0x' + 'AB'.repeat(20)
  assert.equal(isPoolAddress(address), true)
  await fetchPoolMeta(client as unknown as RpcClient, address)
  assert.equal(calls.length, 3)
})
