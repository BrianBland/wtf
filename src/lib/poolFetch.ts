import { RpcClient } from './rpc'

const TOKEN0_SEL  = '0x0dfe1681'
const TOKEN1_SEL  = '0xd21220a7'
const FACTORY_SEL = '0xc45a0155'
const MAX_CONCURRENT_POOL_CALLS = 4

// Known factory addresses on Base — V3-style (CL) and V2-style (classic AMM)
export const FACTORY_PROTOCOLS: Record<string, string> = {
  // Uniswap
  '0x33128a8fc17869897dce68ed026d694621f6fdfd': 'Uniswap V3',
  '0x8909dc15e40173ff4699343b6eb8132c65e18ec6': 'Uniswap V2',
  // Aerodrome (official Slipstream CL factory generations + classic AMM)
  '0xf8f2eb4940cfe7d13603dddd87f123820fc061ef': 'Aerodrome CL',
  '0x5e7bb104d84c7cb9b682aac2f3d509f5f406809a': 'Aerodrome CL',
  '0xade65c38cd4849adba595a4323a8c7ddfe89716a': 'Aerodrome CL',
  '0x9592cd9b267748cbfbde90ac9f7df3c437a6d51b': 'Aerodrome CL',   // Historical
  '0x420dd381b31aef6683db6b902084cb0ffece40da': 'Aerodrome',      // Classic AMM (V2-style)
  // PancakeSwap
  '0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865': 'PancakeSwap V3',
  '0x02a84c1b3bbd7401a5f7fa98a384ebc70bb5749e': 'PancakeSwap V2',
  // SushiSwap
  '0xc35dadb65012ec5796536bd9864ed8773abc74c4': 'SushiSwap V3',
  '0x71524b4f93c58fcbf659783284e38825f0622859': 'SushiSwap V2',
  // BaseSwap
  '0x38015d05f4fec8afe15d7cc0386a126574e8077b': 'BaseSwap V3',
  '0xaed85e1d0c7e6e18335b9ea858ce1ab06934eab5': 'BaseSwap V3',   // Historical
  '0xfda619b6d20975be80a10332cd39b9a4b0faa8bb': 'BaseSwap V2',
  // 9mm
  '0x7b72c4002ea7c276dd717b96b20f4956c5c904e7': '9mm V3',
  // Alien Base
  '0x0fd83557b2be93617c9c1c1b6fd549401c74558c': 'Alien Base V3',
  // Solidly V3
  '0x70fe4a44ea505cfa3a57b95cf2862d4fd5f0f687': 'Solidly V3',
  // Equalizer
  '0xed8db60acc29e14bc867a497d94ca6e3ceb5ec04': 'Equalizer',
  // Hydrex
  '0x36077d39cdc65e1e3fb65810430e5b2c4d5fa29e': 'Hydrex',
  // Algebra
  '0xc5396866754799b9720125b104ae01d935ab9c7b': 'Algebra',
}

export interface PoolMeta {
  token0:   string   // lowercase address
  token1:   string
  factory:  string
  protocol: string   // 'Uniswap V3' | 'Uniswap V2' | 'Aerodrome CL' | 'Aerodrome' | 'Unknown'
}

interface PoolResolverState {
  activeCalls: number
  callQueue: Array<() => void>
  inFlight: Map<string, Promise<PoolMeta>>
}

const resolverStates = new WeakMap<RpcClient, PoolResolverState>()

function getResolverState(client: RpcClient): PoolResolverState {
  let state = resolverStates.get(client)
  if (!state) {
    state = { activeCalls: 0, callQueue: [], inFlight: new Map() }
    resolverStates.set(client, state)
  }
  return state
}

function drainCallQueue(state: PoolResolverState): void {
  while (state.activeCalls < MAX_CONCURRENT_POOL_CALLS) {
    const start = state.callQueue.shift()
    if (!start) return
    start()
  }
}

function scheduleCall<T>(state: PoolResolverState, call: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    state.callQueue.push(() => {
      state.activeCalls++
      const run = async () => {
        try {
          resolve(await call())
        } catch (error) {
          reject(error)
        } finally {
          state.activeCalls--
          drainCallQueue(state)
        }
      }
      // run handles the transport rejection itself, so this detached cleanup task cannot reject.
      void run()
    })
    drainCallQueue(state)
  })
}

function decodeAddressWord(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Malformed ${field} response: expected a 32-byte ABI word`)
  }
  const word = value.slice(2)
  if (!/^0{24}/.test(word)) {
    throw new Error(`Malformed ${field} response: address is not zero-padded`)
  }
  return `0x${word.slice(24).toLowerCase()}`
}

/** Pool metadata calls require an actual 20-byte contract address, never a bytes32 PoolId. */
export function isPoolAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address)
}

async function resolvePoolMeta(
  client: RpcClient,
  state: PoolResolverState,
  poolAddress: string,
  blockTag: string,
): Promise<PoolMeta> {
  const call = (data: string) => scheduleCall(
    state,
    () => client.call<string>('eth_call', [{ to: poolAddress, data }, blockTag]),
  )

  const [t0hex, t1hex, facHex] = await Promise.all([
    call(TOKEN0_SEL),
    call(TOKEN1_SEL),
    call(FACTORY_SEL),
  ])

  const token0   = decodeAddressWord(t0hex, 'token0')
  const token1   = decodeAddressWord(t1hex, 'token1')
  const factory  = decodeAddressWord(facHex, 'factory')
  const zeroAddress = '0x0000000000000000000000000000000000000000'
  if (token0 === zeroAddress) throw new Error('Invalid pool metadata: token0 is the zero address')
  if (token1 === zeroAddress) throw new Error('Invalid pool metadata: token1 is the zero address')
  if (factory === zeroAddress) throw new Error('Invalid pool metadata: factory is the zero address')
  if (token0 === token1) throw new Error('Invalid pool metadata: token0 and token1 are identical')
  const protocol = FACTORY_PROTOCOLS[factory] ?? 'Unknown'

  return { token0, token1, factory, protocol }
}

export async function fetchPoolMeta(
  client: RpcClient,
  poolAddress: string,
  blockTag = 'latest',
): Promise<PoolMeta> {
  if (!isPoolAddress(poolAddress)) throw new Error('Pool metadata requires a 20-byte address')

  const normalizedPool = poolAddress.toLowerCase()
  const state = getResolverState(client)
  const key = `${normalizedPool}:${blockTag}`
  const existing = state.inFlight.get(key)
  if (existing) return existing

  const request = resolvePoolMeta(client, state, normalizedPool, blockTag)
  state.inFlight.set(key, request)
  // Use both handlers instead of a detached finally(): the cleanup promise always fulfills,
  // while the returned request retains its original success or rejection for every caller.
  void request.then(
    () => {
      if (state.inFlight.get(key) === request) state.inFlight.delete(key)
    },
    () => {
      if (state.inFlight.get(key) === request) state.inFlight.delete(key)
    },
  )
  return request
}
