import { RpcClient } from './rpc'

const TOKEN0_SEL  = '0x0dfe1681'
const TOKEN1_SEL  = '0xd21220a7'
const FACTORY_SEL = '0xc45a0155'

// Known factory addresses on Base
const FACTORY_PROTOCOLS: Record<string, string> = {
  '0x33128a8fc17869897dce68ed026d694621f6fdfd': 'Uniswap V3',
  '0x8909dc15e40173ff4699343b6eb8132c65e18ec6': 'Uniswap V2',
  '0x5e7bb104d84c7cb9b682aac2f3d509f5f406809a': 'Aerodrome CL',  // Slipstream
  '0x420dd381b31aef6683db6b902084cb0ffece40da': 'Aerodrome',      // Classic AMM
}

export interface PoolMeta {
  token0:   string   // lowercase address
  token1:   string
  factory:  string
  protocol: string   // 'Uniswap V3' | 'Uniswap V2' | 'Aerodrome CL' | 'Aerodrome' | 'Unknown'
}

function decodeAddr(hex: string): string {
  if (!hex || hex.length < 42) return ''
  return '0x' + hex.slice(-40).toLowerCase()
}

export async function fetchPoolMeta(client: RpcClient, poolAddress: string): Promise<PoolMeta> {
  const call = (data: string) =>
    client.call<string>('eth_call', [{ to: poolAddress, data }, 'latest']).catch(() => '0x')

  const [t0hex, t1hex, facHex] = await Promise.all([
    call(TOKEN0_SEL),
    call(TOKEN1_SEL),
    call(FACTORY_SEL),
  ])

  const token0   = decodeAddr(t0hex)
  const token1   = decodeAddr(t1hex)
  const factory  = decodeAddr(facHex)
  const protocol = FACTORY_PROTOCOLS[factory] ?? 'Unknown'

  return { token0, token1, factory, protocol }
}
