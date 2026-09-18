import { Log, TokenFlow, ProtocolEvent, RawLog } from '../types'
import { fetchPoolMeta, PoolMeta } from './poolFetch'
import {
  TRANSFER_TOPIC, UNI_V3_SWAP_TOPIC, PANCAKE_V3_SWAP_TOPIC, AMM_SWAP_TOPIC, AERODROME_AMM_SWAP_TOPIC,
  AAVE_SUPPLY_TOPIC, AAVE_WITHDRAW_TOPIC, AAVE_BORROW_TOPIC,
  AAVE_REPAY_TOPIC, AAVE_LIQUIDATION_TOPIC,
  COMPOUND_MINT_TOPIC, COMPOUND_REDEEM_TOPIC,
  COMPOUND_BORROW_TOPIC, COMPOUND_REPAY_TOPIC,
  AMM_BURN_TOPIC, UNI_V3_POOL_MINT_TOPIC, UNI_V3_POOL_BURN_TOPIC, UNI_V3_POOL_COLLECT_TOPIC,
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
  topicToAddress, decodeUint256, decodeInt256, decodeAddress,
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
    if (t0 === UNI_V3_SWAP_TOPIC || t0 === PANCAKE_V3_SWAP_TOPIC || t0 === UNI_V3_POOL_MINT_TOPIC || t0 === UNI_V3_POOL_BURN_TOPIC || t0 === UNI_V3_POOL_COLLECT_TOPIC || t0 === AMM_SWAP_TOPIC || t0 === AERODROME_AMM_SWAP_TOPIC || t0 === AMM_BURN_TOPIC) {
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

  // Pre-pass: collect V3 pool addresses from pool-level Mint/Burn/Collect events.
  // NonfungiblePositionManager events (IncreaseLiquidity/DecreaseLiquidity/Collect) fire from
  // the NftPM address — not the pool — so we look up the actual pool from adjacent pool events.
  const v3MintPools: string[] = []
  const v3BurnPools: string[] = []
  interface PoolEventRef { address: string; index: number; consumed: boolean }
  // Pool-level Mint events, tracked with the fields needed to *confirm* — not just guess — that a
  // given IncreaseLiquidity describes the same underlying liquidity addition: same owner (the
  // position is minted directly to this NftPM contract) and identical liquidity/amount0/amount1.
  // A merely-nearby Mint with a different owner or amounts must not be treated as evidence.
  interface PoolMintEventRef extends PoolEventRef {
    owner: string; liquidity: bigint; amount0: bigint; amount1: bigint
  }
  const v3MintEvents: PoolMintEventRef[] = []
  const v3BurnEvents: PoolEventRef[] = []
  // Pool-level Collect events (the canonical source of collection amounts), tracked the same way
  // so a manager Collect can be matched back to the actual pool it collected from — see
  // UNI_V3_COLLECT_TOPIC handling below. Matching requires the pool event's owner to be this
  // NftPM contract plus an exact recipient/amount0/amount1 match.
  interface PoolCollectEventRef extends PoolEventRef {
    owner: string; recipient: string; amount0: bigint; amount1: bigint
  }
  const v3PoolCollectEvents: PoolCollectEventRef[] = []
  logs.forEach((log, index) => {
    const t0 = log.topics[0]?.toLowerCase()
    if (t0 === UNI_V3_POOL_MINT_TOPIC) {
      v3MintPools.push(log.address.toLowerCase())
      // Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)
      v3MintEvents.push({
        address: log.address.toLowerCase(), index, consumed: false,
        owner: log.topics[1] ? topicToAddress(log.topics[1]) : '',
        liquidity: decodeUint256(log.data, 1),
        amount0: decodeUint256(log.data, 2),
        amount1: decodeUint256(log.data, 3),
      })
    }
    if (t0 === UNI_V3_POOL_BURN_TOPIC) {
      v3BurnPools.push(log.address.toLowerCase())
      v3BurnEvents.push({ address: log.address.toLowerCase(), index, consumed: false })
    }
    if (t0 === UNI_V3_POOL_COLLECT_TOPIC) {
      // Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)
      v3PoolCollectEvents.push({
        address: log.address.toLowerCase(), index, consumed: false,
        owner: log.topics[1] ? topicToAddress(log.topics[1]) : '',
        recipient: decodeAddress(log.data, 0),
        amount0: decodeUint256(log.data, 1),
        amount1: decodeUint256(log.data, 2),
      })
    }
  })
  // Resolve protocol for NftPM events via associated pool-level events.
  const resolveNftmProtocol = (poolAddrs: string[], managerAddr?: string): string =>
    poolAddrs.map(a => poolProto(a)).find(p => p !== undefined)
      ?? (managerAddr ? detectPositionManagerClProtocol(managerAddr) : null)
      ?? clProtocol
  // Find the nearest preceding, unconsumed pool Mint that *confirms* this IncreaseLiquidity is the
  // same liquidity addition (same owner, identical liquidity/amount0/amount1) — not merely the
  // nearest Mint by position, which proves nothing about a real relationship between the two logs.
  const findMatchingMint = (
    beforeIndex: number, managerAddr: string, liquidity: bigint, amount0: bigint, amount1: bigint,
  ): PoolMintEventRef | undefined => {
    let best: PoolMintEventRef | undefined
    for (const ev of v3MintEvents) {
      if (ev.index >= beforeIndex || ev.consumed) continue
      if (ev.owner !== managerAddr || ev.liquidity !== liquidity || ev.amount0 !== amount0 || ev.amount1 !== amount1) continue
      if (!best || ev.index > best.index) best = ev
    }
    return best
  }
  // Find the nearest preceding, unconsumed pool-level Collect that *confirms* this NftPM Collect
  // describes the same collection: the pool event's owner is this NftPM contract, and the
  // recipient/amount0/amount1 match exactly. Unrelated Mint/Burn events are never used as evidence.
  const findMatchingPoolCollect = (
    beforeIndex: number, managerAddr: string, recipient: string, amount0: bigint, amount1: bigint,
  ): PoolCollectEventRef | undefined => {
    let best: PoolCollectEventRef | undefined
    for (const ev of v3PoolCollectEvents) {
      if (ev.index >= beforeIndex || ev.consumed) continue
      if (ev.owner !== managerAddr || ev.recipient !== recipient || ev.amount0 !== amount0 || ev.amount1 !== amount1) continue
      if (!best || ev.index > best.index) best = ev
    }
    return best
  }

  logs.forEach((log, i) => {
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
        (log.address === AAVE_V3_POOL_ADDRESS || log.address === SEAMLESS_POOL_ADDRESS) &&
        log.topics.length === 4 && log.topics.every(topic => /^0x[0-9a-f]{64}$/i.test(topic)) &&
        /^0x[0-9a-f]{256}$/i.test(log.data)) {
      const aaveProtocol = log.address === SEAMLESS_POOL_ADDRESS ? 'Seamless' : 'Aave V3'
      protocols.push({
        protocol: aaveProtocol, action: 'Flash Loan',
        // topics: [sig, target, asset, referralCode]; data: [initiator, amount, interestRateMode, premium]
        token:  topicToAddress(log.topics[2]),
        amount: decodeUint256(log.data, 1),
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

    if (t0 === UNI_V3_POOL_COLLECT_TOPIC) {
      // Pool-level Collect is the canonical, authoritative source for a collection's actual pool
      // and amounts — always report it. A matching NftPM Collect below (owner/recipient/amounts
      // confirmed) is suppressed rather than pushed again, so a single collection is never counted
      // twice.
      protocols.push({
        protocol: poolProto(log.address) ?? clProtocol, action: 'CollectFees',
        extra: {
          pool: log.address,
          amount0: decodeUint256(log.data, 1).toString(),
          amount1: decodeUint256(log.data, 2).toString(),
        },
      })
    }

    if (t0 === UNI_V3_INCREASE_LIQ_TOPIC) {
      const liquidity = decodeUint256(log.data, 0)
      const amount0   = decodeUint256(log.data, 1)
      const amount1   = decodeUint256(log.data, 2)
      // The pool-level Mint event (emitted just before this one, from the same underlying
      // pool.mint() call) already records this exact liquidity addition. Only treat it as the same
      // addition — and skip pushing a duplicate — when it's confirmed via owner (the position is
      // minted to this NftPM contract) and matching liquidity/amounts; a merely-preceding,
      // unrelated Mint (different owner, or partial/mismatched amounts) must not suppress this.
      const matchedMint = findMatchingMint(i, log.address.toLowerCase(), liquidity, amount0, amount1)
      if (matchedMint) {
        matchedMint.consumed = true
      } else {
        // No confirmed pool-level Mint in this log window (e.g. truncated log range, or the
        // pool.mint() call isn't in this log set). Preserve the manager + tokenId identity without
        // inventing a `pool` — treating the manager address as a pool would create phantom pool
        // activity/volume/metadata lookups downstream (buildPoolActivity, pool metadata eth_calls).
        protocols.push({
          protocol: detectPositionManagerClProtocol(log.address) ?? clProtocol, action: 'AddLiquidity',
          extra: {
            manager: log.address,
            tokenId: log.topics[1] ? decodeUint256(log.topics[1]).toString() : undefined,
            amount0: amount0.toString(),
            amount1: amount1.toString(),
          },
        })
      }
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
      const recipient = decodeAddress(log.data, 0)
      const amount0   = decodeUint256(log.data, 1)
      const amount1   = decodeUint256(log.data, 2)
      // Attribute to the actual pool via the matching pool-level Collect (owner is this NftPM
      // contract, recipient/amount0/amount1 identical) — never an unrelated Mint/Burn, which proves
      // nothing about which pool was collected from.
      const matched = findMatchingPoolCollect(i, log.address.toLowerCase(), recipient, amount0, amount1)
      if (matched) {
        // Already reported (authoritatively) by the pool-level Collect handler above; consume it
        // so it isn't matched again, and skip pushing a duplicate CollectFees for this manager event.
        matched.consumed = true
      } else {
        // No confirmed pool-level Collect in this log window (e.g. truncated log range, or
        // collecting a position that was fully decreased in an earlier transaction). Preserve
        // manager + tokenId identity without inventing a `pool` — treating the manager address as a
        // pool would create phantom pool activity/volume/metadata lookups downstream.
        protocols.push({
          protocol: detectPositionManagerClProtocol(log.address) ?? clProtocol, action: 'CollectFees',
          extra: {
            manager: log.address,
            tokenId: log.topics[1] ? decodeUint256(log.topics[1]).toString() : undefined,
            amount0: amount0.toString(),
            amount1: amount1.toString(),
          },
        })
      }
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
  })

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
