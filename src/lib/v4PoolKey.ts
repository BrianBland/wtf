// Uniswap V4 PoolKey resolution — Base chain (8453) only.
//
// V4 pools are identified by a bytes32 PoolId (keccak256 of the ABI-encoded PoolKey),
// not by a contract address — every pool shares the singleton PoolManager address.
// To label swap currencies correctly we need the PoolKey (currency0, currency1, fee,
// tickSpacing, hooks) behind a given PoolId. Two verified sources are used, in order:
//
//   1. Canonical `Initialize` events from the Base PoolManager whose decoded key
//      hashes to the full emitted PoolId.
//   2. A fallback `eth_call` to the Base Uniswap V4 PositionManager's public
//      `poolKeys(bytes25)` mapping, when no Initialize event was observed in loaded logs.
//      The returned PoolKey is only accepted after re-hashing it and confirming the
//      result equals the full requested PoolId — this rejects zero/uninitialized,
//      malformed, and mismatched responses rather than guessing.
//
// Reference:
//   https://raw.githubusercontent.com/Uniswap/v4-core/main/src/interfaces/IPoolManager.sol
//   https://raw.githubusercontent.com/Uniswap/v4-periphery/main/src/PositionManager.sol
//   https://docs.uniswap.org/contracts/v4/deployments
//
// Known limitation: custom pools with neither a periphery PositionManager `poolKeys`
// entry nor an observed `Initialize` log remain unresolved — never guessed.

import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { RawLog } from '../types'
import { UNI_V4_POOL_MANAGER_ADDRESS, UNI_V4_SWAP_TOPIC, ETH_NATIVE_ADDRESS } from './protocols'

// Uniswap V4 PositionManager on Base — https://docs.uniswap.org/contracts/v4/deployments
export const UNI_V4_POSITION_MANAGER_ADDRESS = '0x7c5f5a4bbd8fd63184577525326123b519429bdc'

// Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1,
//            uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)
export const UNI_V4_INITIALIZE_TOPIC = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438'

// poolKeys(bytes25) — public mapping getter selector
const POOL_KEYS_SELECTOR = '0x86b6be7d'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export interface V4PoolKey {
  currency0:   string  // lowercase address; 0x0 for native ETH (raw on-chain value, not sentinel-normalized)
  currency1:   string
  fee:         number
  tickSpacing: number
  hooks:       string
}

/** A bytes32 PoolId is 66 chars ("0x" + 64 hex); a contract address is 42 chars. */
export function isV4PoolId(id: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(id)
}

/** Map a PoolKey currency to the app's native-ETH sentinel when it's the zero address. */
export function normalizeV4Currency(addr: string): string {
  return addr === ZERO_ADDRESS ? ETH_NATIVE_ADDRESS : addr
}

function keccak256Hex(hex: string): string {
  return '0x' + bytesToHex(keccak_256(hexToBytes(hex.replace(/^0x/, ''))))
}

function pad32(hex: string): string {
  return hex.replace(/^0x/, '').padStart(64, '0')
}

/** ABI-encode (address,address,uint24,int24,address) and hash — mirrors PoolIdLibrary.toId(). */
export function computePoolId(key: V4PoolKey): string {
  const tickSpacingHex = key.tickSpacing < 0
    ? BigInt.asUintN(256, BigInt(key.tickSpacing)).toString(16)
    : key.tickSpacing.toString(16)
  const encoded =
    pad32(key.currency0) +
    pad32(key.currency1) +
    pad32(key.fee.toString(16)) +
    pad32(tickSpacingHex) +
    pad32(key.hooks)
  return keccak256Hex(encoded)
}

// Validate the complete canonical ABI before decoding any untrusted log/response.
function abiWords(hex: unknown, count: number): string[] | null {
  if (typeof hex !== 'string' || !new RegExp(`^0x[0-9a-fA-F]{${count * 64}}$`).test(hex)) return null
  return hex.slice(2).match(/.{64}/g)!
}

function uintFits(word: string, bits: number): boolean {
  return BigInt('0x' + word) < (1n << BigInt(bits))
}

function signedValue(word: string): bigint {
  return BigInt.asIntN(256, BigInt('0x' + word))
}

function intFits(word: string, bits: number): boolean {
  const value = signedValue(word)
  return BigInt.asIntN(bits, value) === value
}

function addressFromWord(word: string): string {
  return '0x' + word.slice(24).toLowerCase()
}

type EventLog = Pick<RawLog, 'address' | 'topics' | 'data' | 'removed'>

function eventWords(log: EventLog, topic: string, topics: number, words: number): string[] | null {
  if (log.removed || typeof log.address !== 'string' || log.address.toLowerCase() !== UNI_V4_POOL_MANAGER_ADDRESS) return null
  if (!Array.isArray(log.topics) || log.topics.length !== topics ||
      !log.topics.every(t => typeof t === 'string' && isV4PoolId(t)) ||
      log.topics[0].toLowerCase() !== topic) return null
  return abiWords(log.data, words)
}

/** Scan raw logs for canonical, full-PoolId-verified PoolManager Initialize events. */
export function parseInitializeEvents(logs: RawLog[]): Map<string, V4PoolKey> {
  const result = new Map<string, V4PoolKey>()
  for (const log of logs) {
    const words = eventWords(log, UNI_V4_INITIALIZE_TOPIC, 4, 5)
    if (!words || !uintFits(log.topics[2].slice(2), 160) || !uintFits(log.topics[3].slice(2), 160) ||
        !uintFits(words[0], 24) || !intFits(words[1], 24) || !uintFits(words[2], 160) ||
        !uintFits(words[3], 160) || !intFits(words[4], 24)) continue
    const key: V4PoolKey = {
      currency0: addressFromWord(log.topics[2].slice(2)),
      currency1: addressFromWord(log.topics[3].slice(2)),
      fee: Number(BigInt('0x' + words[0])),
      tickSpacing: Number(signedValue(words[1])),
      hooks: addressFromWord(words[2]),
    }
    const poolId = log.topics[1].toLowerCase()
    if (computePoolId(key) === poolId) result.set(poolId, key)
  }
  return result
}

/** Shared by discovery and event decoding so malformed V4 ABI never reaches BigInt decoding. */
export function isValidV4SwapLog(log: EventLog): boolean {
  const words = eventWords(log, UNI_V4_SWAP_TOPIC, 3, 6)
  return !!words && uintFits(log.topics[2].slice(2), 160) &&
    intFits(words[0], 128) && intFits(words[1], 128) && uintFits(words[2], 160) &&
    uintFits(words[3], 128) && intFits(words[4], 24) && uintFits(words[5], 24)
}

/** Collect distinct PoolIds from canonical, non-removed V4 Swap events. */
export function extractV4SwapPoolIds(logs: RawLog[]): Set<string> {
  return new Set(logs.filter(isValidV4SwapLog).map(log => log.topics[1].toLowerCase()))
}

/** ABI-encode the `poolKeys(bytes25)` calldata: first 25 bytes of the PoolId, right-padded to 32. */
export function encodePoolKeysCalldata(poolId: string): string {
  const hex = poolId.replace(/^0x/, '').toLowerCase()
  const prefix25 = hex.slice(0, 50) // 25 bytes = 50 hex chars
  const padded = prefix25.padEnd(64, '0')
  return POOL_KEYS_SELECTOR + padded
}

/** Decode the 5-word (currency0, currency1, fee, tickSpacing, hooks) `poolKeys` return value. */
export function decodePoolKeysResult(hex: string): V4PoolKey | null {
  const words = abiWords(hex, 5)
  if (!words || !uintFits(words[0], 160) || !uintFits(words[1], 160) ||
      !uintFits(words[2], 24) || !intFits(words[3], 24) || !uintFits(words[4], 160)) return null
  return {
    currency0: addressFromWord(words[0]),
    currency1: addressFromWord(words[1]),
    fee: Number(BigInt('0x' + words[2])),
    tickSpacing: Number(signedValue(words[3])),
    hooks: addressFromWord(words[4]),
  }
}

export interface EthCallClient {
  call<T>(method: string, params?: unknown[]): Promise<T>
}

interface ClientState {
  chainId?: bigint
  chainPending?: Promise<bigint | null>
  inFlight: Map<string, Promise<V4PoolKey | null>>
  active: number
  waiters: Array<() => void>
}

const clients = new WeakMap<EthCallClient, ClientState>()
const MAX_CONCURRENT_LOOKUPS = 4

function clientState(client: EthCallClient): ClientState {
  let state = clients.get(client)
  if (!state) {
    state = { inFlight: new Map(), active: 0, waiters: [] }
    clients.set(client, state)
  }
  return state
}

async function chainIdFor(client: EthCallClient, state: ClientState): Promise<bigint | null> {
  if (state.chainId !== undefined) return state.chainId
  if (!state.chainPending) {
    state.chainPending = (async () => {
      try {
        const id = await client.call<string>('eth_chainId', [])
        if (typeof id !== 'string' || !/^0x[0-9a-fA-F]+$/.test(id)) return null
        state.chainId = BigInt(id)
        return state.chainId
      } catch {
        return null // unknown chain; allow a later retry
      }
    })().then(id => {
      state.chainPending = undefined
      return id
    })
  }
  return state.chainPending
}

// Shared across overlapping block loads on this connection, not just one batch.
async function withLookupSlot<T>(state: ClientState, lookup: () => Promise<T>): Promise<T> {
  if (state.active < MAX_CONCURRENT_LOOKUPS) state.active++
  else await new Promise<void>(resolve => state.waiters.push(resolve))
  try {
    return await lookup()
  } finally {
    const next = state.waiters.shift()
    if (next) next() // hand this slot directly to the next lookup
    else state.active--
  }
}

async function fetchFromPositionManager(
  client: EthCallClient,
  poolId: string,
  blockTag: string,
): Promise<V4PoolKey | null> {
  try {
    const data = encodePoolKeysCalldata(poolId)
    const raw = await client.call<string>('eth_call', [{ to: UNI_V4_POSITION_MANAGER_ADDRESS, data }, blockTag])
    const key = decodePoolKeysResult(raw)
    if (!key || (key.currency0 === ZERO_ADDRESS && key.currency1 === ZERO_ADDRESS && key.tickSpacing === 0)) return null
    return computePoolId(key) === poolId ? key : null
  } catch {
    return null // optional metadata (transport/decode/hash failures) must not abort block loading
  }
}

/**
 * Resolve PoolKeys for every V4 Swap PoolId referenced in `logs`.
 *
 * Trusts Initialize events present in `logs` first; falls back to a verified
 * `poolKeys(bytes25)` eth_call against the Base PositionManager (pinned to `blockTag`
 * when provided) for PoolIds not already in `cache` or covered by an Initialize event.
 *
 * Returns only newly-resolved entries — callers merge them into their own cache.
 * Unresolved/failed lookups are intentionally NOT returned/cached here so they can be
 * retried later rather than permanently poisoned.
 */
export async function resolveV4PoolKeys(
  client: EthCallClient,
  logs: RawLog[],
  cache: Map<string, V4PoolKey>,
  blockTag = 'latest',
): Promise<Map<string, V4PoolKey>> {
  const newlyResolved = new Map<string, V4PoolKey>()
  const fromInitialize = parseInitializeEvents(logs)
  const swapPoolIds = extractV4SwapPoolIds(logs)
  if (fromInitialize.size === 0 && swapPoolIds.size === 0) return newlyResolved
  const state = clientState(client)
  const chainId = await chainIdFor(client, state)
  if (chainId !== 8453n) return newlyResolved // gate BOTH sources on the Base deployment

  for (const [id, key] of fromInitialize) {
    if (!cache.has(id)) newlyResolved.set(id, key)
  }

  const toFetch: string[] = []
  for (const id of swapPoolIds) {
    if (cache.has(id) || fromInitialize.has(id)) continue
    toFetch.push(id)
  }

  await Promise.all(toFetch.map(async (id) => {
    const identity = `${chainId}:${blockTag}:${id}`
    let pending = state.inFlight.get(identity)
    if (!pending) {
      pending = withLookupSlot(state, () => fetchFromPositionManager(client, id, blockTag))
        .catch(() => null)
        .then(result => {
          state.inFlight.delete(identity)
          return result
        })
      state.inFlight.set(identity, pending)
    }
    const result = await pending
    if (result) newlyResolved.set(id, result)
  }))

  return newlyResolved
}
