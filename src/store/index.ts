import { create } from 'zustand'
import { Block, CallTrace, NavState } from '../types'
import {
  BlockStateProgress, PrestateResult, PrestateDiffResult, mergePrestate,
} from '../lib/stateAccess'
import { fetchTokenDetails, TokenDetails } from '../lib/tokenFetch'
import { fetchPoolMeta, PoolMeta } from '../lib/poolFetch'
import { loadBlockData } from '../lib/blockProcessing'
import { RpcClient } from '../lib/rpc'
import { estimateElasticity } from '../lib/chainParams'

const MAX_BLOCKS = 200

function withMapValue<K, V>(map: Map<K, V>, key: K, value: V): Map<K, V> {
  const next = new Map(map)
  next.set(key, value)
  return next
}

function applyPoolMeta(
  set: StoreSet,
  newMeta: Map<string, PoolMeta>,
) {
  if (newMeta.size === 0) return
  set((state) => {
    const poolCache = new Map(state.poolCache)
    for (const [addr, meta] of newMeta) poolCache.set(addr, meta)
    return { poolCache }
  })
}

// ── Store ────────────────────────────────────────────────────────────────────

interface Store {
  // Config
  rpcUrl: string
  setRpcUrl: (url: string) => void

  // Connection
  client:    RpcClient | null
  connected: boolean
  connecting: boolean
  connError:  string | null
  connect:    () => Promise<void>
  disconnect: () => void

  // Block data
  blocks:        Map<number, Block>
  latestBlock:   number | null
  initialized:   boolean
  blockLoading:  Set<number>
  addBlock:      (block: Block) => void
  getBlock:      (n: number) => Block | undefined
  getSortedBlocks: () => Block[]
  fetchBlock:    (blockNumber: number) => Promise<void>

  // Navigation
  nav:  NavState
  goto: (state: NavState) => void

  // On-demand traces
  traces:       Map<string, CallTrace>
  traceLoading: Set<string>
  traceError:   Map<string, string>
  fetchTrace:   (txHash: string) => Promise<void>

  // On-demand token metadata
  tokenCache:  Map<string, TokenDetails | 'loading' | 'error'>
  fetchToken:  (address: string) => void
  getToken:    (address: string) => TokenDetails | undefined

  // On-demand pool metadata (token pair + factory-resolved protocol)
  poolCache:   Map<string, PoolMeta | 'loading' | 'error'>
  fetchPool:   (address: string) => void
  getPool:     (address: string) => PoolMeta | undefined

  // Block state access tracing (prestateTracer, progressive)
  blockStateCache:       Map<number, BlockStateProgress>
  startBlockStateTrace:  (blockNumber: number) => void

  // Token prices (USD)
  ethPriceUSD: number
  btcPriceUSD: number
  fetchPrices: () => void

  // Chain parameters (fetched at startup via eth_chainId)
  chainElasticity: number  // EIP-1559 elasticity multiplier (typically 2 or 6)
}

type StoreSet = (partial:
  | Partial<Store>
  | ((state: Store) => Partial<Store> | Store)
) => void

type CacheKey = 'tokenCache' | 'poolCache'
type CacheValue<K extends CacheKey> = K extends 'tokenCache' ? TokenDetails : PoolMeta

const RPC_STORAGE_KEY = 'wtf_rpc_url'
const DEFAULT_RPC_URL = 'wss://base.drpc.org'
let activeConnectionEpoch = 0

function loadSavedRpcUrl(): string {
  try { return localStorage.getItem(RPC_STORAGE_KEY) || DEFAULT_RPC_URL } catch { return DEFAULT_RPC_URL }
}

function createEmptyRuntimeState() {
  return {
    latestBlock: null as number | null,
    initialized: false,
    blocks: new Map<number, Block>(),
    blockLoading: new Set<number>(),
    traces: new Map<string, CallTrace>(),
    traceLoading: new Set<string>(),
    traceError: new Map<string, string>(),
    tokenCache: new Map<string, TokenDetails | 'loading' | 'error'>(),
    poolCache: new Map<string, PoolMeta | 'loading' | 'error'>(),
    blockStateCache: new Map<number, BlockStateProgress>(),
  }
}

function updateCacheEntry<K extends CacheKey>(
  state: Store,
  cacheKey: K,
  address: string,
  value: CacheValue<K> | 'loading' | 'error',
): Pick<Store, K> {
  const cache = withMapValue(
    state[cacheKey] as Map<string, CacheValue<K> | 'loading' | 'error'>,
    address,
    value,
  )
  return { [cacheKey]: cache } as Pick<Store, K>
}

function fetchCachedMetadata<K extends CacheKey>(
  get: () => Store,
  set: StoreSet,
  cacheKey: K,
  address: string,
  load: (client: RpcClient, address: string) => Promise<CacheValue<K>>,
) {
  const state = get()
  const cache = state[cacheKey] as Map<string, CacheValue<K> | 'loading' | 'error'>
  if (!state.client || cache.has(address)) return

  const { client } = state
  set((current) => updateCacheEntry(current, cacheKey, address, 'loading'))

  load(client, address)
    .then((value) => {
      set((current) => updateCacheEntry(current, cacheKey, address, value))
    })
    .catch(() => {
      set((current) => updateCacheEntry(current, cacheKey, address, 'error'))
    })
}

function updateBlockStateProgress(
  set: StoreSet,
  blockNumber: number,
  update: (prev: BlockStateProgress) => BlockStateProgress,
) {
  set((state) => {
    const prev = state.blockStateCache.get(blockNumber)
    if (!prev) return {}
    const blockStateCache = withMapValue(
      state.blockStateCache,
      blockNumber,
      update(prev),
    )
    return { blockStateCache }
  })
}

export type { Store }
export const useStore = create<Store>((set, get) => ({
  rpcUrl: loadSavedRpcUrl(),
  setRpcUrl: (url) => {
    try { localStorage.setItem(RPC_STORAGE_KEY, url) } catch { /* ignore */ }
    set({ rpcUrl: url })
  },

  ethPriceUSD: 2500,
  btcPriceUSD: 100_000,
  fetchPrices: async () => {
    try {
      const res  = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin&vs_currencies=usd')
      const data = await res.json() as { ethereum: { usd: number }; bitcoin: { usd: number } }
      set({ ethPriceUSD: data.ethereum.usd, btcPriceUSD: data.bitcoin.usd })
    } catch { /* keep defaults on error */ }
  },

  client: null, connected: false, connecting: false, connError: null,
  chainElasticity: 6,

  connect: async () => {
    const epoch = ++activeConnectionEpoch
    const { rpcUrl } = get()
    const previousClient = get().client
    set({
      client: null,
      connected: false,
      connecting: true,
      connError: null,
      ...createEmptyRuntimeState(),
    })
    previousClient?.close()

    // ── Phase 1: Establish WebSocket (up to 3 attempts) ─────────────────────
    let activeClient: RpcClient | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      const client = new RpcClient(rpcUrl)
      const isCurrentClient = () =>
        activeConnectionEpoch === epoch && get().client === client
      set({ client })
      client.onDisconnect = () => {
        if (!isCurrentClient()) return
        set({ connected: false })
        // Schedule auto-reconnect if the tab is active and this wasn't an intentional disconnect
        if (document.visibilityState === 'visible') {
          setTimeout(() => {
            const s = get()
            if (activeConnectionEpoch === epoch && s.client === client && !s.connected && !s.connecting) {
              s.connect()
            }
          }, 2_000)
        }
      }

      try {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('Connection timed out')), 30_000)
          client.onConnect = () => {
            if (!isCurrentClient()) return
            clearTimeout(t)
            resolve()
          }
          client.onError = (msg) => {
            if (!isCurrentClient()) return
            clearTimeout(t)
            reject(new Error(msg))
          }
        })
        if (!isCurrentClient()) {
          client.close()
          return
        }
        activeClient = client
        break
      } catch (e) {
        client.close()
        if (attempt < 3) {
          set({ connError: `Attempt ${attempt}/3 failed — retrying…` })
          await new Promise((r) => setTimeout(r, 1_000 * attempt))
        } else {
          set({ connError: (e as Error).message, connecting: false, connected: false })
          return
        }
      }
    }

    const client = activeClient!
    const isCurrentClient = () =>
      activeConnectionEpoch === epoch && get().client === client
    if (!isCurrentClient()) {
      client.close()
      return
    }
    set({ connected: true, connecting: false, connError: null })
    get().fetchPrices()

    // After connection, errors are informational only (don't disconnect)
    client.onError = (msg) => {
      if (!isCurrentClient()) return
      set({ connError: msg })
    }

    const fetchAndStoreBlock = async (blockNumber: number) => {
      try {
        const loaded = await loadBlockData(client, blockNumber, get().poolCache)
        if (!loaded || !isCurrentClient()) return
        applyPoolMeta(set, loaded.newMeta)
        get().addBlock(loaded.block)
      } catch (e) {
        console.warn(`Block ${blockNumber} fetch failed:`, e)
      }
    }

    try {
      const latestHex = await client.call<string>('eth_blockNumber', [])
      if (!isCurrentClient()) return
      const latest    = parseInt(latestHex, 16)
      const start     = Math.max(0, latest - 9)
      await Promise.all(
        Array.from({ length: latest - start + 1 }, (_, i) => fetchAndStoreBlock(start + i))
      )
      if (!isCurrentClient()) return
      set({ initialized: true, latestBlock: latest })
      // Estimate EIP-1559 elasticity from the initial block sample
      set({ chainElasticity: estimateElasticity(get().getSortedBlocks()) })
    } catch (e) {
      if (!isCurrentClient()) return
      // eth_blockNumber itself failed — mark initialized so UI doesn't hang
      set({ initialized: true, connError: `Initial sync failed: ${(e as Error).message}` })
    }

    // ── Phase 3: Subscribe to new heads ─────────────────────────────────────
    try {
      await client.subscribe<{ number: string; hash: string }>(
        'newHeads', null, async (header) => {
          if (!isCurrentClient()) return
          try {
            const blockNumber = parseInt(header.number, 16)
            const loaded = await loadBlockData(client, blockNumber, get().poolCache)
            if (!loaded || !isCurrentClient()) return
            applyPoolMeta(set, loaded.newMeta)
            get().addBlock(loaded.block)
            set({ latestBlock: loaded.block.number })
          } catch (e) {
            console.error('Block fetch error', header.number, e)
          }
        }
      )
    } catch (e) {
      if (!isCurrentClient()) return
      set({ connError: `Subscription failed: ${(e as Error).message}` })
    }
  },

  disconnect: () => {
    activeConnectionEpoch++
    const client = get().client
    set({
      client: null,
      connected: false,
      connecting: false,
      ...createEmptyRuntimeState(),
    })
    client?.close()
  },

  ...createEmptyRuntimeState(),

  fetchBlock: async (blockNumber) => {
    const { client, blocks, blockLoading } = get()
    if (!client || blocks.has(blockNumber) || blockLoading.has(blockNumber)) return
    set((s) => {
      const l = new Set(s.blockLoading)
      l.add(blockNumber)
      return { blockLoading: l }
    })
    try {
      const loaded = await loadBlockData(client, blockNumber, get().poolCache)
      if (loaded && get().client === client) {
        applyPoolMeta(set, loaded.newMeta)
        get().addBlock(loaded.block)
      }
    } catch (e) {
      console.warn(`Block ${blockNumber} fetch failed:`, e)
    }
    set((s) => {
      const l = new Set(s.blockLoading)
      l.delete(blockNumber)
      return { blockLoading: l }
    })
  },

  addBlock: (block) =>
    set((s) => {
      const blocks = new Map(s.blocks)
      blocks.set(block.number, block)
      if (blocks.size > MAX_BLOCKS) {
        // Never evict the currently-viewed block so the user doesn't see "block not found"
        const pinnedBlock = s.nav.view === 'block' ? s.nav.blockNumber
          : s.nav.view === 'tx' ? s.nav.blockNumber
          : undefined
        const sorted = [...blocks.keys()].sort((a, b) => a - b)
        for (const key of sorted) {
          if (key !== pinnedBlock) {
            blocks.delete(key)
            break
          }
        }
      }
      return { blocks }
    }),

  getBlock:       (n) => get().blocks.get(n),
  getSortedBlocks: () => [...get().blocks.values()].sort((a, b) => a.number - b.number),

  nav:  { view: 'config' },
  goto: (nav) => set({ nav }),

  traces: new Map(), traceLoading: new Set(), traceError: new Map(),

  fetchTrace: async (txHash) => {
    const { client, traces, traceLoading } = get()
    if (!client || traces.has(txHash) || traceLoading.has(txHash)) return

    set((s) => {
      const loading = new Set(s.traceLoading)
      loading.add(txHash)
      return { traceLoading: loading }
    })

    try {
      const trace = await client.call<CallTrace>('debug_traceTransaction', [
        txHash, { tracer: 'callTracer' },
      ])
      set((s) => {
        const t = new Map(s.traces)
        t.set(txHash, trace)
        const l = new Set(s.traceLoading)
        l.delete(txHash)
        return { traces: t, traceLoading: l }
      })
    } catch (e) {
      set((s) => {
        const l = new Set(s.traceLoading)
        l.delete(txHash)
        const er = new Map(s.traceError)
        er.set(txHash, (e as Error).message)
        return { traceLoading: l, traceError: er }
      })
    }
  },

  tokenCache: new Map(),

  fetchToken: (address) => {
    fetchCachedMetadata(get, set, 'tokenCache', address, fetchTokenDetails)
  },

  getToken: (address) => {
    const entry = get().tokenCache.get(address)
    return typeof entry === 'object' ? entry : undefined
  },

  poolCache: new Map(),

  fetchPool: (address) => {
    fetchCachedMetadata(get, set, 'poolCache', address, fetchPoolMeta)
  },

  getPool: (address) => {
    const entry = get().poolCache.get(address)
    return typeof entry === 'object' ? entry : undefined
  },

  blockStateCache: new Map(),

  startBlockStateTrace: (blockNumber) => {
    const { blockStateCache, blocks, client } = get()
    if (blockStateCache.has(blockNumber) || !client) return
    const block = blocks.get(blockNumber)
    if (!block) return

    const txHashes = block.transactions.map((tx) => tx.hash)

    set((state) => ({
      blockStateCache: withMapValue(state.blockStateCache, blockNumber, {
        status: 'running',
        done:   0,
        total:  txHashes.length,
        txResults:   new Map(),
        callResults: new Map(),
        errors:      new Set(),
      }),
    }))

    const CONCURRENCY = 6

    ;(async () => {
      for (let i = 0; i < txHashes.length; i += CONCURRENCY) {
        const chunk = txHashes.slice(i, i + CONCURRENCY)
        await Promise.all(chunk.map(async (hash) => {
          try {
            const [allState, diffState, callTrace] = await Promise.all([
              client.call<PrestateResult>(
                'debug_traceTransaction', [hash, { tracer: 'prestateTracer' }]
              ).catch(() => null),
              client.call<PrestateDiffResult>(
                'debug_traceTransaction',
                [hash, { tracer: 'prestateTracer', tracerConfig: { diffMode: true } }]
              ).catch(() => null),
              client.call<CallTrace>(
                'debug_traceTransaction', [hash, { tracer: 'callTracer' }]
              ).catch(() => null),
            ])
            const accesses = mergePrestate(allState ?? {}, diffState ?? { pre: {}, post: {} })
            updateBlockStateProgress(set, blockNumber, (prev) => {
              const txResults = new Map(prev.txResults)
              txResults.set(hash, accesses)
              const callResults = new Map(prev.callResults)
              if (callTrace) callResults.set(hash, callTrace)
              return { ...prev, done: prev.done + 1, txResults, callResults }
            })
          } catch {
            updateBlockStateProgress(set, blockNumber, (prev) => {
              const errors = new Set(prev.errors)
              errors.add(hash)
              return { ...prev, done: prev.done + 1, errors }
            })
          }
        }))
      }

      updateBlockStateProgress(set, blockNumber, (prev) => ({ ...prev, status: 'done' }))
    })()
  },
}))

// Reconnect when the tab becomes visible after a background disconnect
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  const s = useStore.getState()
  if (!s.connected && !s.connecting && s.client !== null) s.connect()
})
