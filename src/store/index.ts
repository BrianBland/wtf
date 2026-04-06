import { create } from 'zustand'
import {
  Block, Transaction, Log, TokenFlow, ProtocolEvent,
  CallTrace, NavState, RawBlock, RawLog, RawReceipt,
} from '../types'
import {
  BlockStateProgress, PrestateResult, PrestateDiffResult, mergePrestate,
} from '../lib/stateAccess'
import { fetchTokenDetails, TokenDetails } from '../lib/tokenFetch'
import { fetchPoolMeta, PoolMeta } from '../lib/poolFetch'
import {
  TRANSFER_TOPIC, UNI_V3_SWAP_TOPIC, PANCAKE_V3_SWAP_TOPIC, AMM_SWAP_TOPIC,
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
  EULER_DEPOSIT_TOPIC, EULER_WITHDRAW_TOPIC, EULER_BORROW_TOPIC, EULER_REPAY_TOPIC,
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
  MORPHO_BLUE_ADDRESS, BALANCER_VAULT_ADDRESS,
  SEAMLESS_POOL_ADDRESS, AAVE_V3_POOL_ADDRESS, COMPOUND3_ADDRESSES,
  AVANTIS_TRADING_ADDRESS, WASABI_ADDRESSES,
  KYBERSWAP_ROUTER_ADDRESS, OPENOCEAN_ROUTER_ADDRESS, ZEROX_PROXY_ADDRESS,
  BASE_L2_BRIDGE_ADDRESS, ACROSS_SPOKE_POOL_ADDRESS, STARGATE_V2_USDC_ADDRESS,
  EVM_CHAIN_NAMES, LZ_EID_NAMES, ETH_NATIVE_ADDRESS,
} from '../lib/protocols'
import {
  hexToBigInt, hexToNumber, getSelector,
  topicToAddress, decodeUint256, decodeInt256,
} from '../lib/formatters'
import { RpcClient } from '../lib/rpc'
import { estimateElasticity } from '../lib/chainParams'

const MAX_BLOCKS = 200

// ── Log processing ──────────────────────────────────────────────────────────

type ProtocolHint = 'aerodrome' | 'uniswap-v3' | null

function detectProtocolHint(txTo: string | null): ProtocolHint {
  if (!txTo) return null
  const addr = txTo.toLowerCase()
  if (AERODROME_ADDRESSES.has(addr)) return 'aerodrome'
  if (UNISWAP_V3_ADDRESSES.has(addr)) return 'uniswap-v3'
  return null
}

// Look up pool factory for every V3 swap log address, fetching any not already cached.
// Returns a pool-address → protocol-name map and any newly fetched PoolMeta entries.
async function fetchV3PoolProtocols(
  client: RpcClient,
  rawLogs: RawLog[],
  poolCache: Map<string, PoolMeta | 'loading' | 'error'>,
): Promise<{ protocols: Map<string, string>; newMeta: Map<string, PoolMeta> }> {
  const v3Pools = new Set<string>()
  for (const log of rawLogs) {
    const t0 = log.topics[0]?.toLowerCase()
    // Include both V3-style and V2-style swap/LP pools — factory lookup disambiguates both
    if (t0 === UNI_V3_SWAP_TOPIC || t0 === PANCAKE_V3_SWAP_TOPIC || t0 === UNI_V3_POOL_MINT_TOPIC || t0 === UNI_V3_POOL_BURN_TOPIC || t0 === AMM_SWAP_TOPIC || t0 === AMM_BURN_TOPIC) {
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

function processLogs(
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
  const resolveNftmProtocol = (poolAddrs: string[]): string =>
    poolAddrs.map(a => poolProto(a)).find(p => p !== undefined) ?? clProtocol

  for (const log of logs) {
    const t0 = log.topics[0]?.toLowerCase()

    // ERC-20 Transfer
    if (t0 === TRANSFER_TOPIC && log.topics.length >= 3) {
      tokenFlows.push({
        token:  log.address,
        from:   topicToAddress(log.topics[1]),
        to:     topicToAddress(log.topics[2]),
        amount: decodeUint256(log.data),
      })
    }

    // V3-style Swap — disambiguated by pool factory lookup; falls back to hint
    // PancakeSwap V3 uses a different topic (two extra protocolFee fields) but same decoded fields
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

    // V2-style AMM Swap — factory lookup disambiguates (Aerodrome, PancakeSwap V2, SushiSwap V2, etc.)
    // Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)
    if (t0 === AMM_SWAP_TOPIC) {
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

    // Aave V3 Supply (also Seamless Protocol — disambiguated by pool address)
    if (t0 === AAVE_SUPPLY_TOPIC && log.topics[1]) {
      const aaveProtocol = log.address === SEAMLESS_POOL_ADDRESS ? 'Seamless' : 'Aave V3'
      protocols.push({
        protocol: aaveProtocol, action: 'Supply',
        token:  topicToAddress(log.topics[1]),
        amount: decodeUint256(log.data, 1),
      })
    }

    // Aave V3 Withdraw (also Seamless)
    if (t0 === AAVE_WITHDRAW_TOPIC && log.topics[1]) {
      const aaveProtocol = log.address === SEAMLESS_POOL_ADDRESS ? 'Seamless' : 'Aave V3'
      protocols.push({
        protocol: aaveProtocol, action: 'Withdraw',
        token:  topicToAddress(log.topics[1]),
        amount: decodeUint256(log.data, 0),
      })
    }

    // Aave V3 Borrow (also Seamless)
    if (t0 === AAVE_BORROW_TOPIC && log.topics[1]) {
      const aaveProtocol = log.address === SEAMLESS_POOL_ADDRESS ? 'Seamless' : 'Aave V3'
      protocols.push({
        protocol: aaveProtocol, action: 'Borrow',
        token:  topicToAddress(log.topics[1]),
        amount: decodeUint256(log.data, 1),
      })
    }

    // Aave V3 Repay (also Seamless)
    if (t0 === AAVE_REPAY_TOPIC && log.topics[1]) {
      const aaveProtocol = log.address === SEAMLESS_POOL_ADDRESS ? 'Seamless' : 'Aave V3'
      protocols.push({
        protocol: aaveProtocol, action: 'Repay',
        token:  topicToAddress(log.topics[1]),
        amount: decodeUint256(log.data, 0),
      })
    }

    // Aave V3 Liquidation (also Seamless)
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

    // Balancer V2 — single vault, poolId is topics[1]
    // Balancer V2 — Swap(bytes32 indexed poolId, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut)
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

    // Aave V3 / Seamless flash loans
    if (t0 === AAVE_FLASH_LOAN_TOPIC &&
        (log.address === AAVE_V3_POOL_ADDRESS || log.address === SEAMLESS_POOL_ADDRESS)) {
      const aaveProtocol = log.address === SEAMLESS_POOL_ADDRESS ? 'Seamless' : 'Aave V3'
      protocols.push({
        protocol: aaveProtocol, action: 'Flash Loan',
        token:  log.topics[3] ? topicToAddress(log.topics[3]) : undefined,
        amount: decodeUint256(log.data, 0),
      })
    }

    // Morpho Blue — fixed address, all market events
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

    // Euler V2 EVaults — Borrow/Repay are vault-specific; Deposit/Withdraw are ERC-4626
    // Only capture Borrow/Repay (unambiguous); skip Deposit/Withdraw (shared with many protocols)
    if (t0 === EULER_BORROW_TOPIC) {
      protocols.push({ protocol: 'Euler', action: 'Borrow', amount: decodeUint256(log.data, 0) })
    }
    if (t0 === EULER_REPAY_TOPIC) {
      protocols.push({ protocol: 'Euler', action: 'Repay', amount: decodeUint256(log.data, 0) })
    }

    // Compound V3 (Comet) — check against known market addresses
    if (COMPOUND3_ADDRESSES.has(log.address)) {
      if (t0 === COMPOUND3_SUPPLY_TOPIC) {
        protocols.push({ protocol: 'Compound V3', action: 'Supply', amount: decodeUint256(log.data, 0) })
      } else if (t0 === COMPOUND3_WITHDRAW_TOPIC) {
        protocols.push({ protocol: 'Compound V3', action: 'Withdraw', amount: decodeUint256(log.data, 0) })
      } else if (t0 === COMPOUND3_ABSORB_TOPIC) {
        protocols.push({ protocol: 'Compound V3', action: 'Liquidation', amount: decodeUint256(log.data, 0) })
      }
    }

    // Avantis perps — MarketExecuted / LimitExecuted from the trading contract
    if (log.address === AVANTIS_TRADING_ADDRESS) {
      if (t0 === AVANTIS_MARKET_EXECUTED_TOPIC) {
        protocols.push({ protocol: 'Avantis', action: 'Market Trade' })
      } else if (t0 === AVANTIS_LIMIT_EXECUTED_TOPIC) {
        protocols.push({ protocol: 'Avantis', action: 'Limit Order Fill' })
      }
    }

    // Wasabi Protocol — position lifecycle events from long/short pools
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

    // KyberSwap MetaAggregation Router v2 — emits Swapped from the router itself
    if (t0 === KYBERSWAP_SWAPPED_TOPIC && log.address === KYBERSWAP_ROUTER_ADDRESS) {
      protocols.push({
        protocol: 'KyberSwap', action: 'Swap',
        token:  log.topics[2] ? topicToAddress(log.topics[2]) : undefined,
        amount: decodeUint256(log.data, 0),
      })
    }

    // OpenOcean Exchange V2
    if (t0 === OPENOCEAN_SWAPPED_TOPIC && log.address === OPENOCEAN_ROUTER_ADDRESS) {
      protocols.push({ protocol: 'OpenOcean', action: 'Swap' })
    }

    // 0x Exchange Proxy — TransformedERC20
    if (t0 === ZEROX_TRANSFORMED_ERC20_TOPIC && log.address === ZEROX_PROXY_ADDRESS) {
      protocols.push({ protocol: '0x Protocol', action: 'Swap' })
    }

    // Uniswap V4 — Pool Manager is a singleton; all pools emit Swap here
    // Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)
    if (t0 === UNI_V4_SWAP_TOPIC && log.address === UNI_V4_POOL_MANAGER_ADDRESS) {
      protocols.push({
        protocol: 'Uniswap V4', action: 'Swap',
        extra: {
          pool:    log.topics[1] ?? '',  // bytes32 pool id
          amount0: decodeInt256(log.data, 0).toString(),
          amount1: decodeInt256(log.data, 1).toString(),
        },
      })
    }

    // ── Bridges ─────────────────────────────────────────────────────────────

    // Base canonical bridge (L2StandardBridge)
    // The canonical bridge always goes to/from Ethereum mainnet (chain 1).
    if (log.address === BASE_L2_BRIDGE_ADDRESS) {
      // ERC20 bridge IN (from Ethereum → Base): newer event
      if (t0 === L2_ERC20_BRIDGE_FINALIZED_TOPIC) {
        protocols.push({
          protocol: 'Base Bridge', action: 'Bridge In',
          token:  log.topics[1] ? topicToAddress(log.topics[1]) : undefined,
          amount: decodeUint256(log.data, 1),  // data: to(addr), amount, extraData
          extra:  { chain: 'Ethereum' },
        })
      } else if (t0 === L2_ERC20_BRIDGE_INITIATED_TOPIC) {
        // ERC20 bridge OUT (Base → Ethereum): newer event
        protocols.push({
          protocol: 'Base Bridge', action: 'Bridge Out',
          token:  log.topics[1] ? topicToAddress(log.topics[1]) : undefined,
          amount: decodeUint256(log.data, 1),
          extra:  { chain: 'Ethereum' },
        })
      } else if (t0 === L2_ETH_BRIDGE_FINALIZED_TOPIC) {
        // ETH bridge IN (from Ethereum → Base)
        protocols.push({
          protocol: 'Base Bridge', action: 'Bridge In',
          token:  ETH_NATIVE_ADDRESS,
          amount: decodeUint256(log.data, 0),
          extra:  { chain: 'Ethereum' },
        })
      } else if (t0 === L2_ETH_BRIDGE_INITIATED_TOPIC) {
        // ETH bridge OUT (Base → Ethereum)
        protocols.push({
          protocol: 'Base Bridge', action: 'Bridge Out',
          token:  ETH_NATIVE_ADDRESS,
          amount: decodeUint256(log.data, 0),
          extra:  { chain: 'Ethereum' },
        })
      } else if (t0 === L2_DEPOSIT_FINALIZED_TOPIC) {
        // Legacy ERC20 bridge-in. Skip when l1Token (topics[1]) is zero address — that means ETH,
        // which is already captured by ETHBridgeFinalized above (both events fire for ETH deposits).
        const l1Token = log.topics[1] ? topicToAddress(log.topics[1]) : null
        if (l1Token && l1Token !== '0x0000000000000000000000000000000000000000') {
          protocols.push({
            protocol: 'Base Bridge', action: 'Bridge In',
            token:  log.topics[2] ? topicToAddress(log.topics[2]) : undefined,  // l2Token
            amount: decodeUint256(log.data, 1),
            extra:  { chain: 'Ethereum' },
          })
        }
      } else if (t0 === L2_WITHDRAWAL_INITIATED_TOPIC) {
        const l1Token = log.topics[1] ? topicToAddress(log.topics[1]) : null
        if (l1Token && l1Token !== '0x0000000000000000000000000000000000000000') {
          protocols.push({
            protocol: 'Base Bridge', action: 'Bridge Out',
            token:  log.topics[2] ? topicToAddress(log.topics[2]) : undefined,  // l2Token
            amount: decodeUint256(log.data, 1),
            extra:  { chain: 'Ethereum' },
          })
        }
      }
    }

    // Across Protocol SpokePool
    if (log.address === ACROSS_SPOKE_POOL_ADDRESS) {
      if (t0 === ACROSS_FUNDS_DEPOSITED_TOPIC) {
        // Bridge OUT: FundsDeposited; topics[1]=destChainId, topics[3]=originToken, data[0]=amount
        const destId = log.topics[1] ? Number(hexToBigInt(log.topics[1])) : 0
        protocols.push({
          protocol: 'Across', action: 'Bridge Out',
          token:  log.topics[3] ? topicToAddress(log.topics[3]) : undefined,
          amount: decodeUint256(log.data, 0),
          extra:  { chain: EVM_CHAIN_NAMES[destId] ?? `Chain ${destId}` },
        })
      } else if (t0 === ACROSS_FILLED_RELAY_TOPIC) {
        // Bridge IN: FilledRelay; topics[1]=originChainId, data[0]=amount
        const srcId = log.topics[1] ? Number(hexToBigInt(log.topics[1])) : 0
        protocols.push({
          protocol: 'Across', action: 'Bridge In',
          amount: decodeUint256(log.data, 0),
          extra:  { chain: EVM_CHAIN_NAMES[srcId] ?? `Chain ${srcId}` },
        })
      }
    }

    // Stargate V2 USDC pool (OFT — omnichain fungible token)
    if (log.address === STARGATE_V2_USDC_ADDRESS) {
      if (t0 === STARGATE_OFT_SENT_TOPIC) {
        // Bridge OUT: OFTSent; data[0]=dstEid(uint32), data[1]=amountSent, data[2]=amountReceived
        const dstEid = Number(decodeUint256(log.data, 0))
        protocols.push({
          protocol: 'Stargate V2', action: 'Bridge Out',
          amount: decodeUint256(log.data, 1),
          extra:  { chain: LZ_EID_NAMES[dstEid] ?? `EID ${dstEid}` },
        })
      } else if (t0 === STARGATE_OFT_RECEIVED_TOPIC) {
        // Bridge IN: OFTReceived; data[0]=srcEid(uint32), data[1]=amountReceived
        const srcEid = Number(decodeUint256(log.data, 0))
        protocols.push({
          protocol: 'Stargate V2', action: 'Bridge In',
          amount: decodeUint256(log.data, 1),
          extra:  { chain: LZ_EID_NAMES[srcEid] ?? `EID ${srcEid}` },
        })
      }
    }

    // Circle CCTP v1 — cross-chain USDC burn+mint
    if (log.address === CCTP_V1_TOKEN_MESSENGER_ADDRESS) {
      if (t0 === CCTP_DEPOSIT_FOR_BURN_TOPIC) {
        // Bridge OUT: DepositForBurn
        // topics[2]=burnToken (indexed), data[0]=amount, data[2]=destinationDomain (uint32)
        const destDomain = Number(decodeUint256(log.data, 2))
        protocols.push({
          protocol: 'CCTP', action: 'Bridge Out',
          token:  log.topics[2] ? topicToAddress(log.topics[2]) : undefined,
          amount: decodeUint256(log.data, 0),
          extra:  { chain: CCTP_DOMAIN_NAMES[destDomain] ?? `Domain ${destDomain}` },
        })
      } else if (t0 === CCTP_MINT_AND_WITHDRAW_TOPIC) {
        // Bridge IN: MintAndWithdraw
        // topics[2]=mintToken (indexed), data[0]=amount
        protocols.push({
          protocol: 'CCTP', action: 'Bridge In',
          token:  log.topics[2] ? topicToAddress(log.topics[2]) : undefined,
          amount: decodeUint256(log.data, 0),
        })
      }
    }

    // Chainlink CCIP — per-lane OnRamps (outbound) and OffRamps (inbound)
    // Each OnRamp/OffRamp contract handles exactly one destination/source lane
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

    // Mint(address,uint256,uint256) is shared between Compound/Moonwell cTokens and Uni V2/Aerodrome pools.
    // Disambiguate: AMM pools index the sender address → topics.length >= 2; cToken Mint has no indexed params.
    if (t0 === COMPOUND_MINT_TOPIC) {
      if (log.topics.length >= 2) {
        // V2-style AMM pool AddLiquidity — factory lookup disambiguates protocol
        protocols.push({
          protocol: poolProto(log.address) ?? ammProtocol, action: 'AddLiquidity',
          extra: {
            pool: log.address,
            amount0: decodeUint256(log.data, 0).toString(),
            amount1: decodeUint256(log.data, 1).toString(),
          },
        })
      } else {
        // Moonwell/Compound cToken Mint(address minter, uint256 mintAmount, uint256 mintTokens)
        // All non-indexed: data[0]=minter, data[1]=mintAmount (underlying), data[2]=mintTokens (cToken)
        protocols.push({
          protocol: 'Moonwell', action: 'Supply',
          token: log.address, amount: decodeUint256(log.data, 1),
        })
      }
    }

    // V2-style AMM LP Burn (RemoveLiquidity) — factory lookup disambiguates protocol
    // Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)
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

    // V3-style pool Mint — disambiguated by pool factory lookup; falls back to hint
    // Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)
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

    // NonfungiblePositionManager IncreaseLiquidity — use pool-level Mint event for protocol/pool
    // IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    if (t0 === UNI_V3_INCREASE_LIQ_TOPIC) {
      const poolAddr = v3MintPools[0] ?? log.address
      protocols.push({
        protocol: resolveNftmProtocol(v3MintPools), action: 'AddLiquidity',
        extra: {
          pool: poolAddr,
          amount0: decodeUint256(log.data, 1).toString(),
          amount1: decodeUint256(log.data, 2).toString(),
        },
      })
    }

    // NonfungiblePositionManager DecreaseLiquidity — use pool-level Burn event for protocol/pool
    // DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    if (t0 === UNI_V3_DECREASE_LIQ_TOPIC) {
      const poolAddr = v3BurnPools[0] ?? log.address
      protocols.push({
        protocol: resolveNftmProtocol(v3BurnPools), action: 'RemoveLiquidity',
        extra: {
          pool: poolAddr,
          amount0: decodeUint256(log.data, 1).toString(),
          amount1: decodeUint256(log.data, 2).toString(),
        },
      })
    }

    // NonfungiblePositionManager Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)
    // topics[1]=tokenId, data[0]=recipient, data[1]=amount0Collected, data[2]=amount1Collected
    if (t0 === UNI_V3_COLLECT_TOPIC) {
      const allPools = v3BurnPools.length > 0 ? v3BurnPools : v3MintPools
      protocols.push({
        protocol: resolveNftmProtocol(allPools), action: 'CollectFees',
        extra: {
          pool: allPools[0] ?? log.address,
          amount0: decodeUint256(log.data, 1).toString(),
          amount1: decodeUint256(log.data, 2).toString(),
        },
      })
    }

    // Moonwell/Compound Redeem(address redeemer, uint256 redeemAmount, uint256 redeemTokens)
    // All non-indexed: data[0]=redeemer, data[1]=redeemAmount (underlying), data[2]=redeemTokens (cToken)
    if (t0 === COMPOUND_REDEEM_TOPIC) {
      protocols.push({
        protocol: 'Moonwell', action: 'Withdraw',
        token: log.address, amount: decodeUint256(log.data, 1),
      })
    }

    // Moonwell/Compound Borrow(address borrower, uint256 borrowAmount, uint256 accountBorrows, uint256 totalBorrows)
    // All non-indexed: data[0]=borrower, data[1]=borrowAmount (underlying)
    if (t0 === COMPOUND_BORROW_TOPIC) {
      protocols.push({
        protocol: 'Moonwell', action: 'Borrow',
        token: log.address, amount: decodeUint256(log.data, 1),
      })
    }

    // Moonwell/Compound RepayBorrow(address payer, address borrower, uint256 repayAmount, ...)
    // All non-indexed: data[0]=payer, data[1]=borrower, data[2]=repayAmount (underlying)
    if (t0 === COMPOUND_REPAY_TOPIC) {
      protocols.push({
        protocol: 'Moonwell', action: 'Repay',
        token: log.address, amount: decodeUint256(log.data, 2),
      })
    }
  }

  return { tokenFlows, protocols }
}

// ── Block processing ─────────────────────────────────────────────────────────

function rawLogToLog(raw: RawLog): Log {
  return {
    address:         raw.address.toLowerCase(),
    topics:          raw.topics.map((t) => t.toLowerCase()),
    data:            raw.data,
    transactionHash: raw.transactionHash.toLowerCase(),
    logIndex:        hexToNumber(raw.logIndex),
  }
}

function processBlock(
  raw: RawBlock,
  rawLogs: RawLog[],
  rawReceipts: RawReceipt[] | null,
  poolProtocols: Map<string, string> = new Map(),
): Block {
  const logsByTx = new Map<string, Log[]>()
  for (const rl of rawLogs) {
    if (rl.removed) continue
    const hash = rl.transactionHash.toLowerCase()
    if (!logsByTx.has(hash)) logsByTx.set(hash, [])
    logsByTx.get(hash)!.push(rawLogToLog(rl))
  }

  const gasUsedByTx = new Map<string, bigint>()
  if (rawReceipts) {
    for (const r of rawReceipts) {
      gasUsedByTx.set(r.transactionHash.toLowerCase(), hexToBigInt(r.gasUsed))
    }
  }

  const transactions: Transaction[] = raw.transactions.map((rawTx) => {
    const hash = rawTx.hash.toLowerCase()
    const logs = logsByTx.get(hash) ?? []
    const hint = detectProtocolHint(rawTx.to)
    const { tokenFlows, protocols } = processLogs(logs, hint, poolProtocols)
    const value = hexToBigInt(rawTx.value)
    const gasUsed = gasUsedByTx.get(hash)
    const maxPriorityFeePerGas = rawTx.maxPriorityFeePerGas
      ? hexToBigInt(rawTx.maxPriorityFeePerGas)
      : undefined
    // gasPrice is present for legacy (type-0) and access-list (type-1) txs
    const gasPrice = rawTx.gasPrice && !rawTx.maxPriorityFeePerGas
      ? hexToBigInt(rawTx.gasPrice)
      : undefined

    return {
      hash,
      blockNumber:    hexToNumber(rawTx.blockNumber),
      index:          hexToNumber(rawTx.transactionIndex),
      from:           rawTx.from.toLowerCase(),
      to:             rawTx.to?.toLowerCase() ?? null,
      value,
      gas:            hexToBigInt(rawTx.gas),
      gasUsed,
      gasPrice,
      maxPriorityFeePerGas,
      input:          rawTx.input,
      methodSelector: getSelector(rawTx.input),
      logs,
      tokenFlows,
      ethFlows:       value > 0n
        ? [{ from: rawTx.from.toLowerCase(), to: rawTx.to?.toLowerCase() ?? '0x', value, type: 'tx' as const }]
        : [],
      protocols,
    }
  })

  return {
    number:       hexToNumber(raw.number),
    hash:         raw.hash.toLowerCase(),
    parentHash:   raw.parentHash.toLowerCase(),
    timestamp:    hexToNumber(raw.timestamp),
    gasUsed:      hexToBigInt(raw.gasUsed),
    gasLimit:     hexToBigInt(raw.gasLimit),
    baseFeePerGas: raw.baseFeePerGas ? hexToBigInt(raw.baseFeePerGas) : 0n,
    miner:        raw.miner.toLowerCase(),
    transactions,
  }
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

const RPC_STORAGE_KEY = 'wtf_rpc_url'
const DEFAULT_RPC_URL = 'wss://base.drpc.org'

function loadSavedRpcUrl(): string {
  try { return localStorage.getItem(RPC_STORAGE_KEY) || DEFAULT_RPC_URL } catch { return DEFAULT_RPC_URL }
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
    const { rpcUrl } = get()
    get().client?.close()
    set({ connecting: true, connError: null, connected: false, initialized: false })

    // ── Phase 1: Establish WebSocket (up to 3 attempts) ─────────────────────
    let activeClient: RpcClient | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      const client = new RpcClient(rpcUrl)
      set({ client })
      client.onDisconnect = () => {
        set({ connected: false })
        // Schedule auto-reconnect if the tab is active and this wasn't an intentional disconnect
        if (document.visibilityState === 'visible') {
          setTimeout(() => {
            const s = get()
            if (!s.connected && !s.connecting && s.client !== null) s.connect()
          }, 2_000)
        }
      }

      try {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('Connection timed out')), 30_000)
          client.onConnect = () => { clearTimeout(t); resolve() }
          client.onError   = (msg) => { clearTimeout(t); reject(new Error(msg)) }
        })
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
    set({ connected: true, connecting: false, connError: null })
    get().fetchPrices()

    // After connection, errors are informational only (don't disconnect)
    client.onError = (msg) => set({ connError: msg })

    // ── Phase 2: Fetch initial blocks (per-block errors are non-fatal) ───────
    const fetchBlock = async (n: number) => {
      const hexN = `0x${n.toString(16)}`
      try {
        const [raw, rawLogs, rawReceipts] = await Promise.all([
          client.call<RawBlock>('eth_getBlockByNumber', [hexN, true]),
          client.call<RawLog[]>('eth_getLogs',          [{ fromBlock: hexN, toBlock: hexN }]),
          client.call<RawReceipt[]>('eth_getBlockReceipts', [hexN]).catch(() => null),
        ])
        if (raw) {
          const logs = rawLogs ?? []
          const { protocols: poolProtocols, newMeta } = await fetchV3PoolProtocols(client, logs, get().poolCache)
          if (newMeta.size > 0) {
            set((s) => {
              const c = new Map(s.poolCache)
              for (const [addr, meta] of newMeta) c.set(addr, meta)
              return { poolCache: c }
            })
          }
          get().addBlock(processBlock(raw, logs, rawReceipts, poolProtocols))
        }
      } catch (e) {
        console.warn(`Block ${n} fetch failed:`, e)
      }
    }

    try {
      const latestHex = await client.call<string>('eth_blockNumber', [])
      const latest    = parseInt(latestHex, 16)
      const start     = Math.max(0, latest - 9)
      await Promise.all(
        Array.from({ length: latest - start + 1 }, (_, i) => fetchBlock(start + i))
      )
      set({ initialized: true, latestBlock: latest })
      // Estimate EIP-1559 elasticity from the initial block sample
      set({ chainElasticity: estimateElasticity(get().getSortedBlocks()) })
    } catch (e) {
      // eth_blockNumber itself failed — mark initialized so UI doesn't hang
      set({ initialized: true, connError: `Initial sync failed: ${(e as Error).message}` })
    }

    // ── Phase 3: Subscribe to new heads ─────────────────────────────────────
    try {
      await client.subscribe<{ number: string; hash: string }>(
        'newHeads', null, async (header) => {
          try {
            const hexN = header.number
            const [raw, rawLogs, rawReceipts] = await Promise.all([
              client.call<RawBlock>('eth_getBlockByNumber', [hexN, true]),
              client.call<RawLog[]>('eth_getLogs', [{ fromBlock: hexN, toBlock: hexN }]),
              client.call<RawReceipt[]>('eth_getBlockReceipts', [hexN]).catch(() => null),
            ])
            if (raw) {
              const logs = rawLogs ?? []
              const { protocols: poolProtocols, newMeta } = await fetchV3PoolProtocols(client, logs, get().poolCache)
              if (newMeta.size > 0) {
                set((s) => {
                  const c = new Map(s.poolCache)
                  for (const [addr, meta] of newMeta) c.set(addr, meta)
                  return { poolCache: c }
                })
              }
              const block = processBlock(raw, logs, rawReceipts, poolProtocols)
              get().addBlock(block)
              set({ latestBlock: block.number })
            }
          } catch (e) {
            console.error('Block fetch error', header.number, e)
          }
        }
      )
    } catch (e) {
      set({ connError: `Subscription failed: ${(e as Error).message}` })
    }

  },

  disconnect: () => {
    get().client?.close()
    set({ client: null, connected: false, blocks: new Map(), latestBlock: null, initialized: false })
  },

  blocks: new Map(), latestBlock: null, initialized: false, blockLoading: new Set(),

  fetchBlock: async (blockNumber) => {
    const { client, blocks, blockLoading } = get()
    if (!client || blocks.has(blockNumber) || blockLoading.has(blockNumber)) return
    const hexN = `0x${blockNumber.toString(16)}`
    set((s) => { const l = new Set(s.blockLoading); l.add(blockNumber); return { blockLoading: l } })
    try {
      const [raw, rawLogs, rawReceipts] = await Promise.all([
        client.call<RawBlock>('eth_getBlockByNumber', [hexN, true]),
        client.call<RawLog[]>('eth_getLogs', [{ fromBlock: hexN, toBlock: hexN }]),
        client.call<RawReceipt[]>('eth_getBlockReceipts', [hexN]).catch(() => null),
      ])
      if (raw) {
        const logs = rawLogs ?? []
        const { protocols: poolProtocols, newMeta } = await fetchV3PoolProtocols(client, logs, get().poolCache)
        if (newMeta.size > 0) {
          set((s) => {
            const c = new Map(s.poolCache)
            for (const [addr, meta] of newMeta) c.set(addr, meta)
            return { poolCache: c }
          })
        }
        get().addBlock(processBlock(raw, logs, rawReceipts, poolProtocols))
      }
    } catch (e) {
      console.warn(`Block ${blockNumber} fetch failed:`, e)
    }
    set((s) => { const l = new Set(s.blockLoading); l.delete(blockNumber); return { blockLoading: l } })
  },

  addBlock: (block) =>
    set((s) => {
      const blocks = new Map(s.blocks)
      blocks.set(block.number, block)
      if (blocks.size > MAX_BLOCKS) {
        // Never evict the currently-viewed block so the user doesn't see "block not found"
        const pinnedBlock = s.nav.view === 'block' ? s.nav.blockNumber
                          : s.nav.view === 'tx'    ? s.nav.blockNumber
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
  getSortedBlocks: ()  => [...get().blocks.values()].sort((a, b) => a.number - b.number),

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
        const t = new Map(s.traces); t.set(txHash, trace)
        const l = new Set(s.traceLoading); l.delete(txHash)
        return { traces: t, traceLoading: l }
      })
    } catch (e) {
      set((s) => {
        const l = new Set(s.traceLoading); l.delete(txHash)
        const er = new Map(s.traceError); er.set(txHash, (e as Error).message)
        return { traceLoading: l, traceError: er }
      })
    }
  },

  tokenCache: new Map(),

  fetchToken: (address) => {
    const { client, tokenCache } = get()
    if (!client || tokenCache.has(address)) return

    set((s) => {
      const c = new Map(s.tokenCache)
      c.set(address, 'loading')
      return { tokenCache: c }
    })

    fetchTokenDetails(client, address)
      .then((details) =>
        set((s) => {
          const c = new Map(s.tokenCache)
          c.set(address, details)
          return { tokenCache: c }
        })
      )
      .catch(() =>
        set((s) => {
          const c = new Map(s.tokenCache)
          c.set(address, 'error')
          return { tokenCache: c }
        })
      )
  },

  getToken: (address) => {
    const entry = get().tokenCache.get(address)
    return typeof entry === 'object' ? entry : undefined
  },

  poolCache: new Map(),

  fetchPool: (address) => {
    const { client, poolCache } = get()
    if (!client || poolCache.has(address)) return

    set((s) => {
      const c = new Map(s.poolCache)
      c.set(address, 'loading')
      return { poolCache: c }
    })

    fetchPoolMeta(client, address)
      .then((meta) =>
        set((s) => {
          const c = new Map(s.poolCache)
          c.set(address, meta)
          return { poolCache: c }
        })
      )
      .catch(() =>
        set((s) => {
          const c = new Map(s.poolCache)
          c.set(address, 'error')
          return { poolCache: c }
        })
      )
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

    // Initialize progress entry
    set((s) => {
      const c = new Map(s.blockStateCache)
      c.set(blockNumber, {
        status: 'running',
        done:   0,
        total:  txHashes.length,
        txResults:   new Map(),
        callResults: new Map(),
        errors:      new Set(),
      })
      return { blockStateCache: c }
    })

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
            set((s) => {
              const prev = s.blockStateCache.get(blockNumber)
              if (!prev) return {}
              const txResults = new Map(prev.txResults)
              txResults.set(hash, accesses)
              const callResults = new Map(prev.callResults)
              if (callTrace) callResults.set(hash, callTrace)
              const c = new Map(s.blockStateCache)
              c.set(blockNumber, { ...prev, done: prev.done + 1, txResults, callResults })
              return { blockStateCache: c }
            })
          } catch {
            set((s) => {
              const prev = s.blockStateCache.get(blockNumber)
              if (!prev) return {}
              const errors = new Set(prev.errors)
              errors.add(hash)
              const c = new Map(s.blockStateCache)
              c.set(blockNumber, { ...prev, done: prev.done + 1, errors })
              return { blockStateCache: c }
            })
          }
        }))
      }

      // Mark complete
      set((s) => {
        const prev = s.blockStateCache.get(blockNumber)
        if (!prev) return {}
        const c = new Map(s.blockStateCache)
        c.set(blockNumber, { ...prev, status: 'done' })
        return { blockStateCache: c }
      })
    })()
  },
}))

// Reconnect when the tab becomes visible after a background disconnect
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  const s = useStore.getState()
  if (!s.connected && !s.connecting && s.client !== null) s.connect()
})
