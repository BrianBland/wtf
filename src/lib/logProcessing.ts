import { Log, TokenFlow, ProtocolEvent, RawLog } from '../types'
import { fetchPoolMeta, PoolMeta } from './poolFetch'
import {
  TRANSFER_TOPIC, UNI_V3_SWAP_TOPIC, PANCAKE_V3_SWAP_TOPIC, AMM_SWAP_TOPIC, AERODROME_AMM_SWAP_TOPIC,
  AAVE_SUPPLY_TOPIC, AAVE_WITHDRAW_TOPIC, AAVE_BORROW_TOPIC,
  AAVE_REPAY_TOPIC, AAVE_LIQUIDATION_TOPIC,
  COMPOUND_MINT_TOPIC, COMPOUND_REDEEM_TOPIC,
  COMPOUND_BORROW_TOPIC, COMPOUND_REPAY_TOPIC,
  AMM_BURN_TOPIC, UNI_V3_POOL_MINT_TOPIC, UNI_V3_POOL_BURN_TOPIC,
  UNI_V3_INCREASE_LIQ_TOPIC, UNI_V3_DECREASE_LIQ_TOPIC, UNI_V3_COLLECT_TOPIC,
  BALANCER_SWAP_TOPIC,
  MORPHO_SUPPLY_TOPIC, MORPHO_SUPPLY_COLLATERAL_TOPIC,
  MORPHO_BORROW_TOPIC, MORPHO_REPAY_TOPIC,
  MORPHO_WITHDRAW_TOPIC, MORPHO_WITHDRAW_COLLATERAL_TOPIC, MORPHO_LIQUIDATE_TOPIC,
  EULER_BORROW_TOPIC, EULER_REPAY_TOPIC,
  COMPOUND3_SUPPLY_TOPIC, COMPOUND3_WITHDRAW_TOPIC, COMPOUND3_ABSORB_TOPIC,
  AAVE_FLASH_LOAN_TOPIC, MORPHO_FLASH_LOAN_TOPIC, BALANCER_FLASH_LOAN_TOPIC,
  AVANTIS_MARKET_EXECUTED_TOPIC, AVANTIS_LIMIT_EXECUTED_TOPIC,
  WASABI_POSITION_OPENED_TOPIC, WASABI_POSITION_CLOSED_TOPIC,
  WASABI_POSITION_CLOSED_WITH_ORDER_TOPIC, WASABI_POSITION_LIQUIDATED_TOPIC,
  WASABI_POSITION_INCREASED_TOPIC, WASABI_POSITION_DECREASED_TOPIC,
  KYBERSWAP_SWAPPED_TOPIC, OPENOCEAN_SWAPPED_TOPIC, ZEROX_TRANSFORMED_ERC20_TOPIC,
  L2_ERC20_BRIDGE_FINALIZED_TOPIC, L2_ERC20_BRIDGE_INITIATED_TOPIC,
  L2_ETH_BRIDGE_FINALIZED_TOPIC, L2_ETH_BRIDGE_INITIATED_TOPIC,
  L2_DEPOSIT_FINALIZED_TOPIC, L2_WITHDRAWAL_INITIATED_TOPIC,
  ACROSS_FUNDS_DEPOSITED_TOPIC, ACROSS_FILLED_RELAY_TOPIC,
  STARGATE_OFT_SENT_TOPIC, STARGATE_OFT_RECEIVED_TOPIC,
  UNI_V4_SWAP_TOPIC, UNI_V4_POOL_MANAGER_ADDRESS,
  CCTP_DEPOSIT_FOR_BURN_TOPIC, CCTP_MINT_AND_WITHDRAW_TOPIC, CCTP_V1_TOKEN_MESSENGER_ADDRESS,
  CCTP_DOMAIN_NAMES,
  CCIP_SEND_REQUESTED_TOPIC, CCIP_EXECUTION_STATE_CHANGED_TOPIC,
  CCIP_ONRAMP_CHAINS, CCIP_OFFRAMP_CHAINS,
  AERODROME_ADDRESSES, UNISWAP_V3_ADDRESSES,
  AERODROME_CL_POSITION_MANAGER_ADDRESSES, UNISWAP_V3_POSITION_MANAGER_ADDRESSES,
  MORPHO_BLUE_ADDRESS, BALANCER_VAULT_ADDRESS,
  SEAMLESS_POOL_ADDRESS, AAVE_V3_POOL_ADDRESS, COMPOUND3_ADDRESSES,
  AVANTIS_TRADING_ADDRESS, WASABI_ADDRESSES,
  KYBERSWAP_ROUTER_ADDRESS, OPENOCEAN_ROUTER_ADDRESS, ZEROX_PROXY_ADDRESS,
  BASE_L2_BRIDGE_ADDRESS, ACROSS_SPOKE_POOL_ADDRESS, STARGATE_V2_USDC_ADDRESS,
  EVM_CHAIN_NAMES, LZ_EID_NAMES, ETH_NATIVE_ADDRESS,
} from './protocols'
import {
  hexToBigInt,
  topicToAddress, decodeUint256, decodeInt256,
} from './formatters'
import { RpcClient } from './rpc'

export type ProtocolHint = 'aerodrome' | 'uniswap-v3' | null

export function detectProtocolHint(txTo: string | null): ProtocolHint {
  if (!txTo) return null
  const addr = txTo.toLowerCase()
  if (AERODROME_ADDRESSES.has(addr)) return 'aerodrome'
  if (UNISWAP_V3_ADDRESSES.has(addr)) return 'uniswap-v3'
  return null
}

function detectPositionManagerClProtocol(address: string): string | null {
  const addr = address.toLowerCase()
  if (AERODROME_CL_POSITION_MANAGER_ADDRESSES.has(addr)) return 'Aerodrome CL'
  if (UNISWAP_V3_POSITION_MANAGER_ADDRESSES.has(addr)) return 'Uniswap V3'
  return null
}

// Look up pool factory for every V3 swap log address, fetching any not already cached.
// Returns a pool-address → protocol-name map and any newly fetched PoolMeta entries.
export async function fetchV3PoolProtocols(
  client: RpcClient,
  rawLogs: RawLog[],
  poolCache: Map<string, PoolMeta | 'loading' | 'error'>,
): Promise<{ protocols: Map<string, string>; newMeta: Map<string, PoolMeta> }> {
  const v3Pools = new Set<string>()
  for (const log of rawLogs) {
    const t0 = log.topics[0]?.toLowerCase()
    // Include both V3-style and V2-style swap/LP pools — factory lookup disambiguates both
    if (t0 === UNI_V3_SWAP_TOPIC || t0 === PANCAKE_V3_SWAP_TOPIC || t0 === UNI_V3_POOL_MINT_TOPIC || t0 === UNI_V3_POOL_BURN_TOPIC || t0 === AMM_SWAP_TOPIC || t0 === AERODROME_AMM_SWAP_TOPIC || t0 === AMM_BURN_TOPIC) {
      v3Pools.add(log.address.toLowerCase())
    }
    // V2 AMM AddLiquidity (COMPOUND_MINT_TOPIC with indexed sender = AMM pool, not cToken)
    if (t0 === COMPOUND_MINT_TOPIC && log.topics.length >= 2) {
      v3Pools.add(log.address.toLowerCase())
    }
  }

  const protocols = new Map<string, string>()
  const toFetch: string[] = []

  for (const addr of v3Pools) {
    const cached = poolCache.get(addr)
    if (cached && typeof cached === 'object') {
      protocols.set(addr, cached.protocol)
    } else if (!cached || cached === 'loading') {
      // Also fetch pools that are 'loading' — another component may have triggered
      // a concurrent fetch, but we need the result synchronously for block processing.
      toFetch.push(addr)
    }
    // 'error' → skip, falls back to hint
  }

  const newMeta = new Map<string, PoolMeta>()
  if (toFetch.length > 0) {
    const results = await Promise.all(
      toFetch.map((addr) => fetchPoolMeta(client, addr).catch(() => null))
    )
    for (let i = 0; i < toFetch.length; i++) {
      const meta = results[i]
      if (meta) {
        protocols.set(toFetch[i], meta.protocol)
        newMeta.set(toFetch[i], meta)
      }
    }
  }

  return { protocols, newMeta }
}

export function processLogs(
  logs: Log[],
  hint: ProtocolHint = null,
  poolProtocols: Map<string, string> = new Map(),
): { tokenFlows: TokenFlow[]; protocols: ProtocolEvent[] } {
  // Hint is used as fallback for pools not in poolProtocols (e.g. factory lookup failed/loading).
  // 'aerodrome' hint → Aerodrome CL / Aerodrome (AMM); 'uniswap-v3' → Uniswap V3; null → Unknown CL/AMM
  const clProtocol  = hint === 'aerodrome' ? 'Aerodrome CL' : hint === 'uniswap-v3' ? 'Uniswap V3' : 'Unknown CL'
  const ammProtocol = hint === 'aerodrome' ? 'Aerodrome' : 'Unknown AMM'
  // Filter out 'Unknown' factory results — treat same as "not yet resolved" so hint fallback applies.
  const poolProto = (addr: string): string | undefined => {
    const p = poolProtocols.get(addr)
    return (p && p !== 'Unknown') ? p : undefined
  }
  const tokenFlows: TokenFlow[] = []
  const protocols: ProtocolEvent[] = []

  // Pre-pass: collect V3 pool addresses from pool-level Mint/Burn events.
  // NonfungiblePositionManager events (IncreaseLiquidity/DecreaseLiquidity/Collect) fire from
  // the NftPM address — not the pool — so we look up the actual pool from adjacent pool events.
  const v3MintPools: string[] = []
  const v3BurnPools: string[] = []
  for (const log of logs) {
    const t0 = log.topics[0]?.toLowerCase()
    if (t0 === UNI_V3_POOL_MINT_TOPIC) v3MintPools.push(log.address.toLowerCase())
    if (t0 === UNI_V3_POOL_BURN_TOPIC) v3BurnPools.push(log.address.toLowerCase())
  }
  // Resolve protocol for NftPM events via associated pool-level events.
  const resolveNftmProtocol = (poolAddrs: string[], managerAddr?: string): string =>
    poolAddrs.map(a => poolProto(a)).find(p => p !== undefined)
      ?? (managerAddr ? detectPositionManagerClProtocol(managerAddr) : null)
      ?? clProtocol

  for (const log of logs) {
    const t0 = log.topics[0]?.toLowerCase()

    if (t0 === TRANSFER_TOPIC && log.topics.length >= 3) {
      tokenFlows.push({
        token:  log.address,
        from:   topicToAddress(log.topics[1]),
        to:     topicToAddress(log.topics[2]),
        amount: decodeUint256(log.data),
      })
    }

    if (t0 === UNI_V3_SWAP_TOPIC || t0 === PANCAKE_V3_SWAP_TOPIC) {
      protocols.push({
        protocol: poolProto(log.address) ?? clProtocol, action: 'Swap',
        extra: {
          pool:    log.address,
          amount0: decodeInt256(log.data, 0).toString(),
          amount1: decodeInt256(log.data, 1).toString(),
        },
      })
    }

    if (t0 === AMM_SWAP_TOPIC || t0 === AERODROME_AMM_SWAP_TOPIC) {
      protocols.push({
        protocol: poolProto(log.address) ?? ammProtocol, action: 'Swap',
        extra: {
          pool:       log.address,
          amount0In:  decodeUint256(log.data, 0).toString(),
          amount1In:  decodeUint256(log.data, 1).toString(),
          amount0Out: decodeUint256(log.data, 2).toString(),
          amount1Out: decodeUint256(log.data, 3).toString(),
        },
      })
    }

    if (t0 === AAVE_SUPPLY_TOPIC && log.topics[1]) {
      const aaveProtocol = log.address === SEAMLESS_POOL_ADDRESS ? 'Seamless' : 'Aave V3'
      protocols.push({
        protocol: aaveProtocol, action: 'Supply',
        token:  topicToAddress(log.topics[1]),
        amount: decodeUint256(log.data, 1),
      })
    }

    if (t0 === AAVE_WITHDRAW_TOPIC && log.topics[1]) {
      const aaveProtocol = log.address === SEAMLESS_POOL_ADDRESS ? 'Seamless' : 'Aave V3'
      protocols.push({
        protocol: aaveProtocol, action: 'Withdraw',
        token:  topicToAddress(log.topics[1]),
        amount: decodeUint256(log.data, 0),
      })
    }

    if (t0 === AAVE_BORROW_TOPIC && log.topics[1]) {
      const aaveProtocol = log.address === SEAMLESS_POOL_ADDRESS ? 'Seamless' : 'Aave V3'
      protocols.push({
        protocol: aaveProtocol, action: 'Borrow',
        token:  topicToAddress(log.topics[1]),
        amount: decodeUint256(log.data, 1),
      })
    }

    if (t0 === AAVE_REPAY_TOPIC && log.topics[1]) {
      const aaveProtocol = log.address === SEAMLESS_POOL_ADDRESS ? 'Seamless' : 'Aave V3'
      protocols.push({
        protocol: aaveProtocol, action: 'Repay',
        token:  topicToAddress(log.topics[1]),
        amount: decodeUint256(log.data, 0),
      })
    }

    if (t0 === AAVE_LIQUIDATION_TOPIC && log.topics[1] && log.topics[2]) {
      const aaveProtocol = log.address === SEAMLESS_POOL_ADDRESS ? 'Seamless' : 'Aave V3'
      protocols.push({
        protocol: aaveProtocol, action: 'Liquidation',
        token:   topicToAddress(log.topics[1]),
        token2:  topicToAddress(log.topics[2]),
        amount:  decodeUint256(log.data, 0),
        amount2: decodeUint256(log.data, 1),
      })
    }

    if (t0 === BALANCER_SWAP_TOPIC && log.address === BALANCER_VAULT_ADDRESS) {
      protocols.push({
        protocol: 'Balancer V2', action: 'Swap',
        token:   log.topics[2] ? topicToAddress(log.topics[2]) : undefined,
        amount:  decodeUint256(log.data, 0),
        token2:  log.topics[3] ? topicToAddress(log.topics[3]) : undefined,
        amount2: decodeUint256(log.data, 1),
      })
    }

    if (t0 === BALANCER_FLASH_LOAN_TOPIC && log.address === BALANCER_VAULT_ADDRESS) {
      protocols.push({
        protocol: 'Balancer V2', action: 'Flash Loan',
        token:  log.topics[2] ? topicToAddress(log.topics[2]) : undefined,
        amount: decodeUint256(log.data, 0),
      })
    }

    if (t0 === AAVE_FLASH_LOAN_TOPIC &&
        (log.address === AAVE_V3_POOL_ADDRESS || log.address === SEAMLESS_POOL_ADDRESS)) {
      const aaveProtocol = log.address === SEAMLESS_POOL_ADDRESS ? 'Seamless' : 'Aave V3'
      protocols.push({
        protocol: aaveProtocol, action: 'Flash Loan',
        token:  log.topics[3] ? topicToAddress(log.topics[3]) : undefined,
        amount: decodeUint256(log.data, 0),
      })
    }

    if (log.address === MORPHO_BLUE_ADDRESS) {
      if (t0 === MORPHO_SUPPLY_TOPIC) {
        protocols.push({ protocol: 'Morpho Blue', action: 'Supply', amount: decodeUint256(log.data, 0) })
      } else if (t0 === MORPHO_SUPPLY_COLLATERAL_TOPIC) {
        protocols.push({ protocol: 'Morpho Blue', action: 'Supply', amount: decodeUint256(log.data, 0) })
      } else if (t0 === MORPHO_BORROW_TOPIC) {
        protocols.push({ protocol: 'Morpho Blue', action: 'Borrow', amount: decodeUint256(log.data, 0) })
      } else if (t0 === MORPHO_REPAY_TOPIC) {
        protocols.push({ protocol: 'Morpho Blue', action: 'Repay', amount: decodeUint256(log.data, 0) })
      } else if (t0 === MORPHO_WITHDRAW_TOPIC) {
        protocols.push({ protocol: 'Morpho Blue', action: 'Withdraw', amount: decodeUint256(log.data, 0) })
      } else if (t0 === MORPHO_WITHDRAW_COLLATERAL_TOPIC) {
        protocols.push({ protocol: 'Morpho Blue', action: 'Withdraw', amount: decodeUint256(log.data, 0) })
      } else if (t0 === MORPHO_LIQUIDATE_TOPIC) {
        protocols.push({ protocol: 'Morpho Blue', action: 'Liquidation', amount: decodeUint256(log.data, 0) })
      } else if (t0 === MORPHO_FLASH_LOAN_TOPIC) {
        protocols.push({
          protocol: 'Morpho Blue', action: 'Flash Loan',
          token:  log.topics[2] ? topicToAddress(log.topics[2]) : undefined,
          amount: decodeUint256(log.data, 0),
        })
      }
    }

    if (t0 === EULER_BORROW_TOPIC) {
      protocols.push({ protocol: 'Euler', action: 'Borrow', amount: decodeUint256(log.data, 0) })
    }
    if (t0 === EULER_REPAY_TOPIC) {
      protocols.push({ protocol: 'Euler', action: 'Repay', amount: decodeUint256(log.data, 0) })
    }

    if (COMPOUND3_ADDRESSES.has(log.address)) {
      if (t0 === COMPOUND3_SUPPLY_TOPIC) {
        protocols.push({ protocol: 'Compound V3', action: 'Supply', amount: decodeUint256(log.data, 0) })
      } else if (t0 === COMPOUND3_WITHDRAW_TOPIC) {
        protocols.push({ protocol: 'Compound V3', action: 'Withdraw', amount: decodeUint256(log.data, 0) })
      } else if (t0 === COMPOUND3_ABSORB_TOPIC) {
        protocols.push({ protocol: 'Compound V3', action: 'Liquidation', amount: decodeUint256(log.data, 0) })
      }
    }

    if (log.address === AVANTIS_TRADING_ADDRESS) {
      if (t0 === AVANTIS_MARKET_EXECUTED_TOPIC) {
        protocols.push({ protocol: 'Avantis', action: 'Market Trade' })
      } else if (t0 === AVANTIS_LIMIT_EXECUTED_TOPIC) {
        protocols.push({ protocol: 'Avantis', action: 'Limit Order Fill' })
      }
    }

    if (WASABI_ADDRESSES.has(log.address)) {
      if (t0 === WASABI_POSITION_OPENED_TOPIC) {
        protocols.push({ protocol: 'Wasabi', action: 'Open Position' })
      } else if (t0 === WASABI_POSITION_CLOSED_TOPIC || t0 === WASABI_POSITION_CLOSED_WITH_ORDER_TOPIC) {
        protocols.push({ protocol: 'Wasabi', action: 'Close Position' })
      } else if (t0 === WASABI_POSITION_LIQUIDATED_TOPIC) {
        protocols.push({ protocol: 'Wasabi', action: 'Liquidation' })
      } else if (t0 === WASABI_POSITION_INCREASED_TOPIC) {
        protocols.push({ protocol: 'Wasabi', action: 'Increase Position' })
      } else if (t0 === WASABI_POSITION_DECREASED_TOPIC) {
        protocols.push({ protocol: 'Wasabi', action: 'Decrease Position' })
      }
    }

    if (t0 === KYBERSWAP_SWAPPED_TOPIC && log.address === KYBERSWAP_ROUTER_ADDRESS) {
      protocols.push({
        protocol: 'KyberSwap', action: 'Swap',
        token:  log.topics[2] ? topicToAddress(log.topics[2]) : undefined,
        amount: decodeUint256(log.data, 0),
      })
    }

    if (t0 === OPENOCEAN_SWAPPED_TOPIC && log.address === OPENOCEAN_ROUTER_ADDRESS) {
      protocols.push({ protocol: 'OpenOcean', action: 'Swap' })
    }

    if (t0 === ZEROX_TRANSFORMED_ERC20_TOPIC && log.address === ZEROX_PROXY_ADDRESS) {
      protocols.push({ protocol: '0x Protocol', action: 'Swap' })
    }

    if (t0 === UNI_V4_SWAP_TOPIC && log.address === UNI_V4_POOL_MANAGER_ADDRESS) {
      protocols.push({
        protocol: 'Uniswap V4', action: 'Swap',
        extra: {
          pool:    log.topics[1] ?? '',
          amount0: decodeInt256(log.data, 0).toString(),
          amount1: decodeInt256(log.data, 1).toString(),
        },
      })
    }

    if (log.address === BASE_L2_BRIDGE_ADDRESS) {
      if (t0 === L2_ERC20_BRIDGE_FINALIZED_TOPIC) {
        protocols.push({
          protocol: 'Base Bridge', action: 'Bridge In',
          token:  log.topics[1] ? topicToAddress(log.topics[1]) : undefined,
          amount: decodeUint256(log.data, 1),
          extra:  { chain: 'Ethereum' },
        })
      } else if (t0 === L2_ERC20_BRIDGE_INITIATED_TOPIC) {
        protocols.push({
          protocol: 'Base Bridge', action: 'Bridge Out',
          token:  log.topics[1] ? topicToAddress(log.topics[1]) : undefined,
          amount: decodeUint256(log.data, 1),
          extra:  { chain: 'Ethereum' },
        })
      } else if (t0 === L2_ETH_BRIDGE_FINALIZED_TOPIC) {
        protocols.push({
          protocol: 'Base Bridge', action: 'Bridge In',
          token:  ETH_NATIVE_ADDRESS,
          amount: decodeUint256(log.data, 0),
          extra:  { chain: 'Ethereum' },
        })
      } else if (t0 === L2_ETH_BRIDGE_INITIATED_TOPIC) {
        protocols.push({
          protocol: 'Base Bridge', action: 'Bridge Out',
          token:  ETH_NATIVE_ADDRESS,
          amount: decodeUint256(log.data, 0),
          extra:  { chain: 'Ethereum' },
        })
      } else if (t0 === L2_DEPOSIT_FINALIZED_TOPIC) {
        const l1Token = log.topics[1] ? topicToAddress(log.topics[1]) : null
        if (l1Token && l1Token !== '0x0000000000000000000000000000000000000000') {
          protocols.push({
            protocol: 'Base Bridge', action: 'Bridge In',
            token:  log.topics[2] ? topicToAddress(log.topics[2]) : undefined,
            amount: decodeUint256(log.data, 1),
            extra:  { chain: 'Ethereum' },
          })
        }
      } else if (t0 === L2_WITHDRAWAL_INITIATED_TOPIC) {
        const l1Token = log.topics[1] ? topicToAddress(log.topics[1]) : null
        if (l1Token && l1Token !== '0x0000000000000000000000000000000000000000') {
          protocols.push({
            protocol: 'Base Bridge', action: 'Bridge Out',
            token:  log.topics[2] ? topicToAddress(log.topics[2]) : undefined,
            amount: decodeUint256(log.data, 1),
            extra:  { chain: 'Ethereum' },
          })
        }
      }
    }

    if (log.address === ACROSS_SPOKE_POOL_ADDRESS) {
      if (t0 === ACROSS_FUNDS_DEPOSITED_TOPIC) {
        const destId = log.topics[1] ? Number(hexToBigInt(log.topics[1])) : 0
        protocols.push({
          protocol: 'Across', action: 'Bridge Out',
          token:  log.topics[3] ? topicToAddress(log.topics[3]) : undefined,
          amount: decodeUint256(log.data, 0),
          extra:  { chain: EVM_CHAIN_NAMES[destId] ?? `Chain ${destId}` },
        })
      } else if (t0 === ACROSS_FILLED_RELAY_TOPIC) {
        const srcId = log.topics[1] ? Number(hexToBigInt(log.topics[1])) : 0
        protocols.push({
          protocol: 'Across', action: 'Bridge In',
          amount: decodeUint256(log.data, 0),
          extra:  { chain: EVM_CHAIN_NAMES[srcId] ?? `Chain ${srcId}` },
        })
      }
    }

    if (log.address === STARGATE_V2_USDC_ADDRESS) {
      if (t0 === STARGATE_OFT_SENT_TOPIC) {
        const dstEid = Number(decodeUint256(log.data, 0))
        protocols.push({
          protocol: 'Stargate V2', action: 'Bridge Out',
          amount: decodeUint256(log.data, 1),
          extra:  { chain: LZ_EID_NAMES[dstEid] ?? `EID ${dstEid}` },
        })
      } else if (t0 === STARGATE_OFT_RECEIVED_TOPIC) {
        const srcEid = Number(decodeUint256(log.data, 0))
        protocols.push({
          protocol: 'Stargate V2', action: 'Bridge In',
          amount: decodeUint256(log.data, 1),
          extra:  { chain: LZ_EID_NAMES[srcEid] ?? `EID ${srcEid}` },
        })
      }
    }

    if (log.address === CCTP_V1_TOKEN_MESSENGER_ADDRESS) {
      if (t0 === CCTP_DEPOSIT_FOR_BURN_TOPIC) {
        const destDomain = Number(decodeUint256(log.data, 2))
        protocols.push({
          protocol: 'CCTP', action: 'Bridge Out',
          token:  log.topics[2] ? topicToAddress(log.topics[2]) : undefined,
          amount: decodeUint256(log.data, 0),
          extra:  { chain: CCTP_DOMAIN_NAMES[destDomain] ?? `Domain ${destDomain}` },
        })
      } else if (t0 === CCTP_MINT_AND_WITHDRAW_TOPIC) {
        protocols.push({
          protocol: 'CCTP', action: 'Bridge In',
          token:  log.topics[2] ? topicToAddress(log.topics[2]) : undefined,
          amount: decodeUint256(log.data, 0),
        })
      }
    }

    if (t0 === CCIP_SEND_REQUESTED_TOPIC) {
      const destChain = CCIP_ONRAMP_CHAINS[log.address]
      if (destChain !== undefined) {
        protocols.push({
          protocol: 'Chainlink CCIP', action: 'Bridge Out',
          extra: { chain: destChain },
        })
      }
    }
    if (t0 === CCIP_EXECUTION_STATE_CHANGED_TOPIC) {
      const srcChain = CCIP_OFFRAMP_CHAINS[log.address]
      if (srcChain !== undefined) {
        protocols.push({
          protocol: 'Chainlink CCIP', action: 'Bridge In',
          extra: { chain: srcChain },
        })
      }
    }

    if (t0 === COMPOUND_MINT_TOPIC) {
      if (log.topics.length >= 2) {
        protocols.push({
          protocol: poolProto(log.address) ?? ammProtocol, action: 'AddLiquidity',
          extra: {
            pool: log.address,
            amount0: decodeUint256(log.data, 0).toString(),
            amount1: decodeUint256(log.data, 1).toString(),
          },
        })
      } else {
        protocols.push({
          protocol: 'Moonwell', action: 'Supply',
          token: log.address, amount: decodeUint256(log.data, 1),
        })
      }
    }

    if (t0 === AMM_BURN_TOPIC) {
      protocols.push({
        protocol: poolProto(log.address) ?? ammProtocol, action: 'RemoveLiquidity',
        extra: {
          pool: log.address,
          amount0: decodeUint256(log.data, 0).toString(),
          amount1: decodeUint256(log.data, 1).toString(),
        },
      })
    }

    if (t0 === UNI_V3_POOL_MINT_TOPIC) {
      protocols.push({
        protocol: poolProto(log.address) ?? clProtocol, action: 'AddLiquidity',
        extra: {
          pool: log.address,
          amount0: decodeUint256(log.data, 2).toString(),
          amount1: decodeUint256(log.data, 3).toString(),
        },
      })
    }

    if (t0 === UNI_V3_INCREASE_LIQ_TOPIC) {
      const poolAddr = v3MintPools[0] ?? log.address
      protocols.push({
        protocol: resolveNftmProtocol(v3MintPools, log.address), action: 'AddLiquidity',
        extra: {
          pool: poolAddr,
          amount0: decodeUint256(log.data, 1).toString(),
          amount1: decodeUint256(log.data, 2).toString(),
        },
      })
    }

    if (t0 === UNI_V3_DECREASE_LIQ_TOPIC) {
      const poolAddr = v3BurnPools[0] ?? log.address
      protocols.push({
        protocol: resolveNftmProtocol(v3BurnPools, log.address), action: 'RemoveLiquidity',
        extra: {
          pool: poolAddr,
          amount0: decodeUint256(log.data, 1).toString(),
          amount1: decodeUint256(log.data, 2).toString(),
        },
      })
    }

    if (t0 === UNI_V3_COLLECT_TOPIC) {
      const allPools = v3BurnPools.length > 0 ? v3BurnPools : v3MintPools
      protocols.push({
        protocol: resolveNftmProtocol(allPools, log.address), action: 'CollectFees',
        extra: {
          pool: allPools[0] ?? log.address,
          amount0: decodeUint256(log.data, 1).toString(),
          amount1: decodeUint256(log.data, 2).toString(),
        },
      })
    }

    if (t0 === COMPOUND_REDEEM_TOPIC) {
      protocols.push({
        protocol: 'Moonwell', action: 'Withdraw',
        token: log.address, amount: decodeUint256(log.data, 1),
      })
    }

    if (t0 === COMPOUND_BORROW_TOPIC) {
      protocols.push({
        protocol: 'Moonwell', action: 'Borrow',
        token: log.address, amount: decodeUint256(log.data, 1),
      })
    }

    if (t0 === COMPOUND_REPAY_TOPIC) {
      protocols.push({
        protocol: 'Moonwell', action: 'Repay',
        token: log.address, amount: decodeUint256(log.data, 2),
      })
    }
  }

  const hasV4Swaps = protocols.some(ev => ev.protocol === 'Uniswap V4' && ev.action === 'Swap')
  if (hasV4Swaps) {
    const pmAddr = UNI_V4_POOL_MANAGER_ADDRESS
    const pmIn  = tokenFlows.filter(f => f.to === pmAddr)
    const pmOut = tokenFlows.filter(f => f.from === pmAddr)
    for (const ev of protocols) {
      if (ev.protocol !== 'Uniswap V4' || ev.action !== 'Swap' || !ev.extra) continue
      const a0 = BigInt(ev.extra.amount0 as string)
      const a1 = BigInt(ev.extra.amount1 as string)
      let inFlow
      let outFlow
      if (a0 > 0n) {
        inFlow = pmIn.find(f => f.amount === a0) ?? pmIn[0]
        outFlow = pmOut.find(f => f.amount === -a1) ?? pmOut[0]
      } else {
        inFlow = pmIn.find(f => f.amount === a1) ?? pmIn[0]
        outFlow = pmOut.find(f => f.amount === -a0) ?? pmOut[0]
      }
      if (inFlow) {
        ev.extra.tokenIn = inFlow.token
        ev.extra.amountIn = inFlow.amount.toString()
      }
      if (outFlow) {
        ev.extra.tokenOut = outFlow.token
        ev.extra.amountOut = outFlow.amount.toString()
      }
    }
  }

  return { tokenFlows, protocols }
}
