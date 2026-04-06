// Known Base chain addresses, tokens, protocols, and event signatures

export interface TokenInfo {
  symbol: string
  decimals: number
  color: string
}

// Sentinel address for native ETH (used when a bridge or protocol deals in ETH, not WETH)
export const ETH_NATIVE_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export const KNOWN_TOKENS: Record<string, TokenInfo> = {
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': { symbol: 'ETH',    decimals: 18, color: '#627eea' },
  '0x4200000000000000000000000000000000000006': { symbol: 'WETH',   decimals: 18, color: '#627eea' },
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC',   decimals: 6,  color: '#2775ca' },
  '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2': { symbol: 'USDT',   decimals: 6,  color: '#26a17b' },
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { symbol: 'cbBTC',  decimals: 8,  color: '#f7931a' },
  '0x940181a94a35a4569e4529a3cdfb74e38fd98631': { symbol: 'AERO',   decimals: 18, color: '#00c4e0' },
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { symbol: 'DAI',    decimals: 18, color: '#f5ac37' },
  '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': { symbol: 'cbETH',  decimals: 18, color: '#4888f0' },
  '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': { symbol: 'wstETH', decimals: 18, color: '#00a3ff' },
  '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a': { symbol: 'weETH',  decimals: 18, color: '#24b76a' },
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': { symbol: 'USDbC',  decimals: 6,  color: '#1a8fe3' },
  '0xab36452dbac151be02b16ca17d8919826072f64a': { symbol: 'rETH',   decimals: 18, color: '#ff6b35' },
}

export interface ProtocolInfo {
  name: string
  type: 'dex' | 'lending' | 'token' | 'bridge' | 'other'
}

export const KNOWN_PROTOCOLS: Record<string, ProtocolInfo> = {
  // Uniswap V3
  '0x2626664c2603336e57b271c5c0b26f421741e481': { name: 'Uniswap V3 Router',  type: 'dex' },
  '0x33128a8fc17869897dce68ed026d694621f6fdfd': { name: 'Uniswap V3 Factory', type: 'dex' },
  '0x198ef1ec325a96cc354c7266a038be8b5c558f67': { name: 'Uniswap V3 NftPM',   type: 'dex' },
  '0x03a520b32c04bf3beef7beb72e919cf822ed34f1': { name: 'Uniswap V3 NftPM2',  type: 'dex' },
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': { name: 'Uniswap Universal Router', type: 'dex' },
  // Aerodrome (classic AMM + Slipstream CL)
  '0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43': { name: 'Aerodrome Router',         type: 'dex' },
  '0x420dd381b31aef6683db6b902084cb0ffece40da': { name: 'Aerodrome Factory',         type: 'dex' },
  '0xade65c38cd4849adba595a4323a8c7ddfe89716a': { name: 'Aerodrome V2 Factory',      type: 'dex' },
  '0x827922686190fd9b3eb5c2af8154a8ab3efb61d5': { name: 'Aerodrome Voter',           type: 'dex' },
  '0x5e7bb104d84c7cb9b682aac2f3d509f5f406809a': { name: 'Aerodrome CL Factory',      type: 'dex' },
  '0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5': { name: 'Aerodrome CL SwapRouter',   type: 'dex' },
  // PancakeSwap
  '0x678aa4bf4e210cf2166753e054d5b7c31cc7fa86': { name: 'PancakeSwap V3 Router',     type: 'dex' },
  '0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865': { name: 'PancakeSwap V3 Factory',    type: 'dex' },
  '0x02a84c1b3bbd7401a5f7fa98a384ebc70bb5749e': { name: 'PancakeSwap V2 Factory',    type: 'dex' },
  // SushiSwap
  '0xc35dadb65012ec5796536bd9864ed8773abc74c4': { name: 'SushiSwap V3 Factory',      type: 'dex' },
  '0x71524b4f93c58fcbf659783284e38825f0622859': { name: 'SushiSwap V2 Factory',      type: 'dex' },
  // BaseSwap
  '0xaed85e1d0c7e6e18335b9ea858ce1ab06934eab5': { name: 'BaseSwap V3 Factory',       type: 'dex' },
  '0xfda619b6d20975be80a10332cd39b9a4b0faa8bb': { name: 'BaseSwap V2 Factory',       type: 'dex' },
  // Alien Base
  '0x0fd83557b2be93617c9c1c1b6fd549401c74558c': { name: 'Alien Base V3 Factory',     type: 'dex' },
  // Solidly V3
  '0x70fe4a44ea505cfa3a57b95cf2862d4fd5f0f687': { name: 'Solidly V3 Factory',        type: 'dex' },
  // Equalizer
  '0xed8db60acc29e14bc867a497d94ca6e3ceb5ec04': { name: 'Equalizer Factory',          type: 'dex' },
  // Hydrex
  '0x36077d39cdc65e1e3fb65810430e5b2c4d5fa29e': { name: 'Hydrex Factory',             type: 'dex' },
  // Balancer V2
  '0xba12222222228d8ba445958a75a0704d566bf2c8': { name: 'Balancer V2 Vault',         type: 'dex' },
  // Aave V3
  '0xa238dd80c259a72e81d7e4664a9801593f98d1c5': { name: 'Aave V3 Pool',              type: 'lending' },
  '0xe20fcbdbffc4dd138ce8b2e6fbb6cb49777ad64': { name: 'Aave V3 Rewards',           type: 'lending' },
  // Seamless Protocol (Aave V3 fork on Base)
  '0x8f44fd754285aa6a2b8b9b97739b79746e0475a7': { name: 'Seamless Pool',             type: 'lending' },
  // Moonwell (Compound V2 fork)
  '0xfbb21d0380bee3312b33c4353c8936a0f13ef26c': { name: 'Moonwell Comptroller',      type: 'lending' },
  // Morpho Blue
  '0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb': { name: 'Morpho Blue',               type: 'lending' },
  // Euler Finance V2 (EVC-based)
  '0x5301c7dd20bd945d2013b48ed0dee3a284ca8989': { name: 'Euler EVC',                 type: 'lending' },
  '0x7f321498a801a191a93c840750ed637149ddf8d0': { name: 'Euler eVault Factory',      type: 'lending' },
  // Compound V3 (Comet) markets on Base
  '0xb125e6687d4313864e53df431d5425969c15eb2f': { name: 'Compound V3 USDC',          type: 'lending' },
  '0x46e6b214b524310239732d51387075e0e70970bf': { name: 'Compound V3 WETH',          type: 'lending' },
  '0x9c4ec768c28520b50860ea7a15bd7213a9ff58bf': { name: 'Compound V3 USDbC',         type: 'lending' },
  '0x2c776041ccfe903071af44aa147368a9c8eea518': { name: 'Compound V3 USDS',          type: 'lending' },
  '0x784efeb622244d2348d4f2522f8860b96fbece89': { name: 'Compound V3 AERO',          type: 'lending' },
  // Base Bridge
  '0x4200000000000000000000000000000000000010': { name: 'L2 Standard Bridge',        type: 'bridge' },
  '0x3154cf16ccdb4c6d922629664174b904d80f2c35': { name: 'Base Bridge',               type: 'bridge' },
  // WETH
  '0x4200000000000000000000000000000000000006': { name: 'WETH',                      type: 'token' },
  // Aggregators
  '0x1111111254eeb25477b68fb85ed929f73a960582': { name: '1inch Router',              type: 'dex' },
  '0x6131b5fae19ea4f9d964eac0408e4408b66337b5': { name: 'KyberSwap Router',          type: 'dex' },
  '0x6352a56caadc4f1e25cd6c75970fa768a3304e64': { name: 'OpenOcean Router',          type: 'dex' },
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff': { name: '0x Exchange Proxy',         type: 'dex' },
  // Bridges — canonical + third-party
  '0x4200000000000000000000000000000000000010': { name: 'Base Bridge',               type: 'bridge' },
  '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64': { name: 'Across SpokePool',          type: 'bridge' },
  '0x27a16dc786820b16e5c9028b75b99f6f604b5d26': { name: 'Stargate V2',               type: 'bridge' },
  // Stargate V1 (legacy)
  '0x45f1a95a4d3f3836523f5c83673c797f4d4d263b': { name: 'Stargate USDC Pool',        type: 'bridge' },
  // Avantis (perps DEX)
  '0x0c16ff40065cc3ab4bc55b60e447504afb9c7970': { name: 'Avantis Trading',           type: 'other' },
  // Wasabi Protocol (options / perps)
  '0xbdae5df498a45c5f058e3a09afe9ba4da7b248aa': { name: 'Wasabi Long Pool',          type: 'other' },
  '0xa456c77d358c9c89f4dfb294fa2a47470b7da37c': { name: 'Wasabi Short Pool',         type: 'other' },
  // Uniswap V4
  '0x6ff5693b99212da76ad316178a184ab56d299b43': { name: 'Uniswap V4 Universal Router', type: 'dex' },
  '0x498581ff718922c3f8e6a244956af099b2652b2b': { name: 'Uniswap V4 Pool Manager',    type: 'dex' },
  // Circle CCTP v1
  '0x1682ae6375c4e4a97e4b583bc394c861a46d8962': { name: 'CCTP TokenMessenger',       type: 'bridge' },
  '0xaD09780d193884d503182aD4588450C416D6F9D4': { name: 'CCTP MessageTransmitter',   type: 'bridge' },
  // Chainlink CCIP Router
  '0x881e3a65b4d4a04dd529061dd0071cf975f58bcd': { name: 'CCIP Router',               type: 'bridge' },
  // ERC-4337 EntryPoint
  '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789': { name: 'EntryPoint v0.6',           type: 'other' },
  '0x0000000071727de22e5e9d8baf0edac6f37da032': { name: 'EntryPoint v0.7',           type: 'other' },
}

// Address sets for protocol routing disambiguation
export const AERODROME_ADDRESSES = new Set([
  '0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43',  // Router
  '0x420dd381b31aef6683db6b902084cb0ffece40da',  // Factory
  '0x827922686190fd9b3eb5c2af8154a8ab3efb61d5',  // Voter
  '0x5e7bb104d84c7cb9b682aac2f3d509f5f406809a',  // CL Factory
  '0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5',  // CL SwapRouter
])

export const UNISWAP_V3_ADDRESSES = new Set([
  '0x2626664c2603336e57b271c5c0b26f421741e481',  // SwapRouter02
  '0x33128a8fc17869897dce68ed026d694621f6fdfd',  // Factory
  '0x198ef1ec325a96cc354c7266a038be8b5c558f67',  // NonfungiblePositionManager
  '0x03a520b32c04bf3beef7beb72e919cf822ed34f1',  // NonfungiblePositionManager2
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad',  // Universal Router
])

// Fixed-address protocols (same across all chains)
export const MORPHO_BLUE_ADDRESS    = '0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb'
export const BALANCER_VAULT_ADDRESS = '0xba12222222228d8ba445958a75a0704d566bf2c8'

// Seamless pool (Aave V3 fork) — emits same events as Aave; we distinguish by address
export const SEAMLESS_POOL_ADDRESS  = '0x8f44fd754285aa6a2b8b9b97739b79746e0475a7'

// Aave V3 pool on Base
export const AAVE_V3_POOL_ADDRESS   = '0xa238dd80c259a72e81d7e4664a9801593f98d1c5'

// Compound V3 Comet market addresses on Base
export const COMPOUND3_ADDRESSES = new Set([
  '0xb125e6687d4313864e53df431d5425969c15eb2f',  // cUSDCv3
  '0x46e6b214b524310239732d51387075e0e70970bf',  // cWETHv3
  '0x9c4ec768c28520b50860ea7a15bd7213a9ff58bf',  // cUSDbCv3
  '0x2c776041ccfe903071af44aa147368a9c8eea518',  // cUSDSv3
  '0x784efeb622244d2348d4f2522f8860b96fbece89',  // cAEROv3
])

export const USDC_ADDRESS  = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
export const USDT_ADDRESS  = '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2'
export const WETH_ADDRESS  = '0x4200000000000000000000000000000000000006'
export const CBBTC_ADDRESS = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'

// Avantis perps DEX — main trading/settlement contract
export const AVANTIS_TRADING_ADDRESS = '0x0c16ff40065cc3ab4bc55b60e447504afb9c7970'

// Wasabi Protocol options/perps pools
export const WASABI_ADDRESSES = new Set([
  '0xbdae5df498a45c5f058e3a09afe9ba4da7b248aa',  // Long Pool
  '0xa456c77d358c9c89f4dfb294fa2a47470b7da37c',  // Short Pool
])

// KyberSwap MetaAggregation Router v2 — emits Swapped events from the router itself
export const KYBERSWAP_ROUTER_ADDRESS  = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5'
export const OPENOCEAN_ROUTER_ADDRESS  = '0x6352a56caadc4f1e25cd6c75970fa768a3304e64'
export const ZEROX_PROXY_ADDRESS       = '0xdef1c0ded9bec7f1a1670819833240f027b25eff'

// Uniswap V4 — Pool Manager is a singleton (all pools share one contract)
export const UNI_V4_POOL_MANAGER_ADDRESS = '0x498581ff718922c3f8e6a244956af099b2652b2b'

// Circle CCTP v1 — cross-chain USDC transfers via burn+mint
export const CCTP_V1_TOKEN_MESSENGER_ADDRESS = '0x1682ae6375c4e4a97e4b583bc394c861a46d8962'

// CCTP domain ID → chain name
export const CCTP_DOMAIN_NAMES: Record<number, string> = {
  0: 'Ethereum',
  1: 'Avalanche',
  2: 'Optimism',
  3: 'Arbitrum',
  4: 'Noble',
  5: 'Solana',
  6: 'Base',
  7: 'Polygon',
  8: 'Sui',
  9: 'Aptos',
}

// Chainlink CCIP OnRamp address → destination chain name (Bridge Out)
// Each OnRamp is a dedicated per-lane contract; source is always Base
export const CCIP_ONRAMP_CHAINS: Record<string, string> = {
  '0x362e6be957c18e268ad91046ca6b47eb09ad98c1': 'Optimism',
  '0xe5fd5a0ec3657ad58e875518e73f6264e00eb754': 'BNB Chain',
  '0xd3bde678bb706cf727a512515c254bcf021dd203': 'Polygon',
  '0x56b30a0dcd8dc87ec08b80fa09502bab801fa78e': 'Ethereum',
  '0x9d0ffa76c7f82c34be313b5bfc6d42a72da8ca69': 'Arbitrum',
  '0x4be6e0f97ea849ff80773af7a317356e6c646fd7': 'Avalanche',
}

// Chainlink CCIP OffRamp address → source chain name (Bridge In)
// Each OffRamp is a dedicated per-lane contract; destination is always Base
export const CCIP_OFFRAMP_CHAINS: Record<string, string> = {
  '0xca04169671a81e4fb8768cfad46c347ae65371f1': 'Ethereum',
  '0x18095fbd53184a50c2bb3929a6c62ca328732062': 'Optimism',
  '0x45d524b6fe99c005c52c65c578dc0e02d9751083': 'BNB Chain',
  '0x74d574d11977fc8d40f8590c419504cbe178adb7': 'Polygon',
  '0x7d38c6363d5e4dfd500a691bc34878b383f58d93': 'Arbitrum',
  '0x0a44db4366385483cbcc9460fa55a75345553286': 'Unknown',  // chain selector 0x5ffb1764e3994092
}

// Bridge contracts
export const BASE_L2_BRIDGE_ADDRESS    = '0x4200000000000000000000000000000000000010'
export const ACROSS_SPOKE_POOL_ADDRESS = '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64'
export const STARGATE_V2_USDC_ADDRESS  = '0x27a16dc786820b16e5c9028b75b99f6f604b5d26'

// EVM chain ID → human-readable name (used by Across and canonical bridge)
export const EVM_CHAIN_NAMES: Record<number, string> = {
  1:       'Ethereum',
  10:      'Optimism',
  56:      'BNB Chain',
  137:     'Polygon',
  324:     'zkSync Era',
  1101:    'Polygon zkEVM',
  5000:    'Mantle',
  8453:    'Base',
  34443:   'Mode',
  42161:   'Arbitrum',
  43114:   'Avalanche',
  59144:   'Linea',
  534352:  'Scroll',
  81457:   'Blast',
}

// LayerZero V2 endpoint ID → chain name (used by Stargate V2 OFT events)
export const LZ_EID_NAMES: Record<number, string> = {
  30101: 'Ethereum',
  30102: 'BNB Chain',
  30106: 'Avalanche',
  30109: 'Polygon',
  30110: 'Arbitrum',
  30111: 'Optimism',
  30125: 'Celo',
  30165: 'zkSync Era',
  30181: 'Mantle',
  30183: 'Linea',
  30184: 'Base',
  30214: 'Scroll',
  30217: 'Kava',
  30260: 'Mode',
  30272: 'Blast',
  30326: 'Zircuit',
}

// 4-byte method selectors
export const KNOWN_SELECTORS: Record<string, string> = {
  // ERC20
  '0xa9059cbb': 'transfer',
  '0x23b872dd': 'transferFrom',
  '0x095ea7b3': 'approve',
  // WETH
  '0xd0e30db0': 'deposit',        // WETH deposit (wrap ETH)
  '0x2e1a7d4d': 'withdraw',       // WETH withdraw (unwrap)
  // Aave V3
  '0x617ba037': 'supply',
  '0xa415bcad': 'borrow',
  '0x573ade81': 'repay',
  '0x94b576de': 'repayWithATokens',
  '0x69328dec': 'withdraw',
  '0xe0232576': 'liquidationCall',
  '0xd5ead7b3': 'flashLoan',
  // Aave V2
  '0xe8eda9df': 'deposit',
  // Uniswap V3
  '0x04e45aaf': 'exactInputSingle',
  '0xb858183f': 'exactInput',
  '0xdb3e2198': 'exactOutputSingle',
  '0x09b81346': 'exactOutput',
  '0x128acb08': 'swap',           // V3 pool swap
  '0xac9650d8': 'multicall',
  '0x5ae401dc': 'multicall',
  '0x472b43f3': 'swapExactTokensForTokens',
  '0x42712a67': 'swapTokensForExactTokens',
  '0x3593564c': 'execute',        // Universal Router
  // Aerodrome
  '0xdf440b60': 'swapExactTokensForTokens',
  '0xe8e33700': 'addLiquidity',
  '0xbaa2abde': 'removeLiquidity',
  '0x544cd4e0': 'swapExactETHForTokens',
  // Classic Uni V2-style
  '0x7ff36ab5': 'swapExactETHForTokens',
  '0x18cbafe5': 'swapExactTokensForETH',
  '0xf305d719': 'addLiquidityETH',
  '0x2195995c': 'removeLiquidityWithPermit',
  // ERC-4337
  '0x1fad948c': 'handleOps',       // EntryPoint v0.6
  '0x765e827f': 'handleOps',       // EntryPoint v0.7
  // Misc
  '0x1cff79cd': 'execute',
  '0x6a761202': 'execTransaction', // Gnosis Safe
}

// ERC-4337 EntryPoint — UserOperationEvent(bytes32 indexed,address indexed,address indexed,uint256,bool,uint256,uint256)
export const USER_OPERATION_EVENT_TOPIC = '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f'

// ERC20 Transfer — topic0
export const TRANSFER_TOPIC   = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
export const APPROVAL_TOPIC   = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'
// Uniswap V3 Swap(address,address,int256,int256,uint160,uint128,int24)
export const UNI_V3_SWAP_TOPIC    = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'
// PancakeSwap V3 Swap — same fields + uint128 protocolFeesToken0, uint128 protocolFeesToken1
export const PANCAKE_V3_SWAP_TOPIC = '0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83'
// Classic AMM Swap(address indexed sender, uint,uint,uint,uint, address indexed to)
export const AMM_SWAP_TOPIC         = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
// Aerodrome V2 AMM Swap(address indexed sender, address indexed to, uint,uint,uint,uint) — same data layout, different sig
export const AERODROME_AMM_SWAP_TOPIC = '0xb3e2773606abfd36b5bd91394b3a54d1398336c65005baf7bf7a05efeffaf75b'
// Aave V3 events
export const AAVE_SUPPLY_TOPIC       = '0x2b627736bca15cd5381dcf80b0bf11fd197d01a037c52b927a881a10fb73ba61'
export const AAVE_WITHDRAW_TOPIC     = '0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7'
export const AAVE_BORROW_TOPIC       = '0xc6a898309e823ee50bac64e45ca8adba6690e99e7841c45d754785487320f9ce'
export const AAVE_REPAY_TOPIC        = '0xa534c8dbe71f871f9f3530e97a74601fea17b426cae02e1c5aee42c96c784051'
export const AAVE_LIQUIDATION_TOPIC  = '0xe413a321e8681d831f4dbccbeca18f7eab7cf8d0a5c8ead7f3ba01b35d4b9e7'
// Moonwell / Compound V2 events
// NOTE: COMPOUND_MINT_TOPIC is shared with Uni V2 / Aerodrome pool Mint — disambiguate by log.topics.length:
//   topics.length >= 2 → AMM LP Mint (indexed sender)
//   topics.length === 1 → Compound/Moonwell cToken mint (no indexed params)
export const COMPOUND_MINT_TOPIC   = '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f'
export const COMPOUND_REDEEM_TOPIC = '0xe5b754fb1abb7f01b499791d0b820ae3b6af3424ac1c59768edb53f4ec31a929'
export const COMPOUND_BORROW_TOPIC = '0x13ed6866d4e1ee6da46f845c46d7e54120883d75c5ea9a2dacc1c4ca8984ab80'
export const COMPOUND_REPAY_TOPIC  = '0x1a2a22cb034d26d1854bdc6a1da3f587a5e8bb8e7ac2b96cb5b9c70620d8bc8a'
// Aerodrome / Uni V2 AMM LP events
// Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)
export const AMM_BURN_TOPIC        = '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4cf2e500068de590b6f'
// Uniswap V3 / Aerodrome Slipstream pool Mint (concentrated liquidity pool-level event)
// Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)
export const UNI_V3_POOL_MINT_TOPIC = '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde'
// Uniswap V3 / Aerodrome Slipstream pool Burn (concentrated liquidity pool-level event)
// Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)
export const UNI_V3_POOL_BURN_TOPIC  = '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c'
// Uniswap V3 NonfungiblePositionManager LP events
// IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
export const UNI_V3_INCREASE_LIQ_TOPIC = '0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35c'
// DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
export const UNI_V3_DECREASE_LIQ_TOPIC = '0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4'
// Collect(uint256 indexed tokenId, address recipient, uint256 amount0Collected, uint256 amount1Collected)
export const UNI_V3_COLLECT_TOPIC      = '0x40d0efd1a53d60ecbf40971b9daf7dc90178c3eff3b3f722c8d5fdd96b56f8c9'
// Balancer V2 — Swap(bytes32 indexed poolId, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut)
export const BALANCER_SWAP_TOPIC = '0x2170c741c41531aec20e7c107c24eecfdd15e69c9bb0a8dd37b1840b9e0b207b'
// Morpho Blue events (from morpho-org/morpho-blue EventsLib.sol)
// Supply(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)
export const MORPHO_SUPPLY_TOPIC              = '0xedf8870433c83823eb071d3df1caa8d008f12f6440918c20d75a3602cda30fe0'
// SupplyCollateral(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets)
export const MORPHO_SUPPLY_COLLATERAL_TOPIC   = '0xa3b9472a1399e17e123f3c2e6586c23e504184d504de59cdaa2b375e880c6184'
// Borrow(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)
export const MORPHO_BORROW_TOPIC              = '0x570954540bed6b1304a87dfe815a5eda4a648f7097a16240dcd85c9b5fd42a43'
// Repay(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)
export const MORPHO_REPAY_TOPIC               = '0x52acb05cebbd3cd39715469f22afbf5a17496295ef3bc9bb5944056c63ccaa09'
// Withdraw(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)
export const MORPHO_WITHDRAW_TOPIC            = '0xa56fc0ad5702ec05ce63666221f796fb62437c32db1aa1aa075fc6484cf58fbf'
// WithdrawCollateral(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets)
export const MORPHO_WITHDRAW_COLLATERAL_TOPIC = '0xe80ebd7cc9223d7382aab2e0d1d6155c65651f83d53c8b9b06901d167e321142'
// Liquidate(bytes32 indexed id, address indexed caller, address indexed borrower, uint256 repaidAssets, uint256 repaidShares, uint256 seizedAssets, uint256 badDebtAssets, uint256 badDebtShares)
export const MORPHO_LIQUIDATE_TOPIC           = '0xa4946ede45d0c6f06a0f5ce92c9ad3b4751452d2fe0e25010783bcab57a67e41'
// WETH wrap/unwrap events (canonical WETH9 and ERC-4626 WETH)
// Deposit(address indexed dst, uint256 wad) — emitted on wrap (ETH → WETH)
export const WETH_DEPOSIT_TOPIC    = '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c'
// Withdrawal(address indexed src, uint256 wad) — emitted on unwrap (WETH → ETH)
export const WETH_WITHDRAWAL_TOPIC = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65'
// Euler V2 EVault events (ERC-4626 + custom borrow/repay)
// Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares)
export const EULER_DEPOSIT_TOPIC  = '0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7'
// Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)
export const EULER_WITHDRAW_TOPIC = '0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db'
// Borrow(address indexed account, uint256 assets)
export const EULER_BORROW_TOPIC   = '0xcbc04eca7e9da35cb1393a6135a199ca52e450d5e9251cbd99f7847d33a36750'
// Repay(address indexed account, uint256 assets)
export const EULER_REPAY_TOPIC    = '0x5c16de4f8b59bd9caf0f49a545f25819a895ed223294290b408242e72a594231'
// Compound V3 (Comet) events
// Supply(address indexed from, address indexed dst, uint256 amount)
export const COMPOUND3_SUPPLY_TOPIC   = '0xd1cf3d156d5f8f0d50f6c122ed609cec09d35c9b9fb3fff6ea0959134dae424e'
// Withdraw(address indexed src, address indexed to, uint256 amount)
export const COMPOUND3_WITHDRAW_TOPIC = '0x9b1bfa7fa9ee420a16e124f794c35ac9f90472acc99140eb2f6447c714cad8eb'
// AbsorbDebt(address indexed absorber, address indexed borrower, uint256 basePaidOut, uint256 usdValue) — liquidation
export const COMPOUND3_ABSORB_TOPIC   = '0x1547a878dc89ad3c367b6338b4be6a65a5dd74fb77ae044da1e8747ef1f4f62f'
// Flash loan events
// Aave V3: FlashLoan(address indexed target, address indexed initiator, address indexed asset, uint256 amount, uint8 interestRateMode, uint256 premium, uint16 referralCode)
export const AAVE_FLASH_LOAN_TOPIC     = '0x631042c832b07452973831137f2d73e395028b44b250dedc5abb0ee766e168ac'
// Morpho Blue: FlashLoan(address indexed caller, address indexed token, uint256 assets)
export const MORPHO_FLASH_LOAN_TOPIC   = '0xc76f1b4fe4396ac07a9fa55a415d4ca430e72651d37d3401f3bed7cb13fc4f12'
// Balancer V2: FlashLoan(address indexed recipient, address indexed token, uint256 amount, uint256 feeAmount)
export const BALANCER_FLASH_LOAN_TOPIC = '0x0d7d75e01ab95780d3cd1c8ec0dd6c2ce19e3a20427eec8bf53283b6fb8e95f0'

// ── Bridge event topics ───────────────────────────────────────────────────
// Base L2StandardBridge — canonical bridge (L2 side only)
// ERC20BridgeFinalized(address indexed localToken, address indexed remoteToken, address indexed from, address to, uint256 amount, bytes extraData)
export const L2_ERC20_BRIDGE_FINALIZED_TOPIC  = '0xd59c65b35445225835c83f50b6ede06a7be047d22e357073e250d9af537518cd'
// ERC20BridgeInitiated(address indexed localToken, address indexed remoteToken, address indexed from, address to, uint256 amount, bytes extraData)
export const L2_ERC20_BRIDGE_INITIATED_TOPIC  = '0x7ff126db8024424bbfd9826e8ab82ff59136289ea440b04b39a0df1b03b9cabf'
// ETHBridgeFinalized(address indexed from, address indexed to, uint256 amount, bytes extraData)
export const L2_ETH_BRIDGE_FINALIZED_TOPIC    = '0x31b2166ff604fc5672ea5df08a78081d2bc6d746cadce880747f3643d819e83d'
// ETHBridgeInitiated(address indexed from, address indexed to, uint256 amount, bytes extraData)
export const L2_ETH_BRIDGE_INITIATED_TOPIC    = '0x2849b43074093a05396b6f2a937dee8565b15a48a7b3d4bffb732a5017380af5'
// DepositFinalized (legacy ERC20 bridge-in event, still emitted alongside ERC20BridgeFinalized)
export const L2_DEPOSIT_FINALIZED_TOPIC       = '0xb0444523268717a02698be47d0803aa7468c00acbed2f8bd93a0459cde61dd89'
// WithdrawalInitiated (legacy ERC20 bridge-out event)
export const L2_WITHDRAWAL_INITIATED_TOPIC    = '0x73d170910aba9e6d50b102db522b1dbcd796216f5128b445aa2135272886497e'
// Across SpokePool V2
// FundsDeposited: topics[1]=destinationChainId, topics[3]=originToken, data[0]=amount
export const ACROSS_FUNDS_DEPOSITED_TOPIC     = '0x32ed1a409ef04c7b0227189c3a103dc5ac10e775a15b785dcc510201f7c25ad3'
// FilledRelay: topics[1]=originChainId, data[0]=amount
export const ACROSS_FILLED_RELAY_TOPIC        = '0x44b559f101f8fbcc8a0ea43fa91a05a729a5ea6e14a7c75aa750374690137208'
// Stargate V2 OFT (omnichain fungible token) events
// OFTSent: topics[1]=guid, topics[2]=fromAddress; data[0]=dstEid, data[1]=amountSent, data[2]=amountReceived
export const STARGATE_OFT_SENT_TOPIC          = '0x85496b760a4b7f8d66384b9df21b381f5d1b1e79f229a47aaf4c232edc2fe59a'
// OFTReceived: topics[1]=guid, topics[2]=toAddress; data[0]=srcEid, data[1]=amountReceived
export const STARGATE_OFT_RECEIVED_TOPIC      = '0xefed6d3500546b29533b128a29e3a94d70788727f0507505ac12eaf2e578fd9c'

// Avantis perps — MarketExecuted and LimitExecuted from trading contract
export const AVANTIS_MARKET_EXECUTED_TOPIC = '0x5c00d8b4c6c92b4922d1bd61ef722ec9a29169acb95d956676b07be6a6643eea'
export const AVANTIS_LIMIT_EXECUTED_TOPIC  = '0xbf3d234454deff88435a11abb8501124ff9e6923fd2fdfc730d83474b6ffbe2c'
// Wasabi Protocol position lifecycle events (both long and short pools)
export const WASABI_POSITION_OPENED_TOPIC            = '0x41ae823bf4c91d7bece87d6eada54c198fd07594ad19d96d72d025896049bfdb'
export const WASABI_POSITION_CLOSED_TOPIC            = '0x75b84e1e549840eae7725d388221efd1eff0445233ca8ba75c16fe9aa4420f9d'
export const WASABI_POSITION_CLOSED_WITH_ORDER_TOPIC = '0x6fe8780cb281bfa04b1136759ae4474c3ada2c511162f19556f299187c63340a'
export const WASABI_POSITION_LIQUIDATED_TOPIC        = '0xc84dd454965cb66936af89c78c1833d5dc2554cd53f6ef2ad1f7b0945a94c593'
export const WASABI_POSITION_INCREASED_TOPIC         = '0xe80a6b78f88f08b92cac13fc3aa5b23cf4753f8fb8bd85e4b356b670634f77f7'
export const WASABI_POSITION_DECREASED_TOPIC         = '0xbf109bd723f23a8453e35c569e9a1249639bca162cab600e8ac822cffeb84e55'
// KyberSwap MetaAggregation Router v2 — Swapped(address,address,address,address,uint256,uint256)
export const KYBERSWAP_SWAPPED_TOPIC  = '0xd6d4f5681c246c9f42c203e287975af1601f8df8035a9251f79aab5c8f09e2f8'
// OpenOcean Exchange V2 — Swapped(address,address,address,address,uint256,uint256,uint256,uint256,uint256,address)
export const OPENOCEAN_SWAPPED_TOPIC  = '0x76af224a143865a50b41496e1a73622698692c565c1214bc862f18e22d829c5e'
// 0x Exchange Proxy — TransformedERC20(address indexed taker, address inputToken, address outputToken, uint256 inputTokenAmount, uint256 outputTokenAmount)
export const ZEROX_TRANSFORMED_ERC20_TOPIC = '0x0f6672f78a59ba8e5e5b5d38df3ebc67f3c792e2c9259b8d97d7f00dd78ba1b3'

// Uniswap V4 — Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)
export const UNI_V4_SWAP_TOPIC = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f'

// Circle CCTP v1 events (from TokenMessenger)
// DepositForBurn(uint64 indexed nonce, address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller)
export const CCTP_DEPOSIT_FOR_BURN_TOPIC    = '0x2fa9ca894982930190727e75500a97d8dc500233a5065e0f3126c48fbe0343c0'
// MintAndWithdraw(address indexed mintRecipient, uint256 amount, address indexed mintToken)
export const CCTP_MINT_AND_WITHDRAW_TOPIC   = '0x1b2a7ff080b8cb6ff436ce0372e399692bbfb6d4ae5766fd8d58a7b8cc6142e6'

// Chainlink CCIP events
// CCIPSendRequested(EVM2EVMMessage message) — from OnRamp; message struct is ABI-encoded in data (no indexed params)
export const CCIP_SEND_REQUESTED_TOPIC            = '0xd0c3c799bf9e2639de44391e7f524d229b2b55f5b1ea94b2bf7da42f7243dddd'
// ExecutionStateChanged(uint64 indexed sequenceNumber, bytes32 indexed messageId, uint8 state, bytes returnData) — from OffRamp
export const CCIP_EXECUTION_STATE_CHANGED_TOPIC   = '0xd4f851956a5d67c3997d1c9205045fef79bae2947fdee7e9e2641abc7391ef65'

// ── Protocol brand colors ─────────────────────────────────────────────────
// Shared across Histogram, ProtocolDrillDown, and any other component that
// needs to color-code protocol names consistently.

export const PROTOCOL_COLORS: Record<string, string> = {
  // DEX — V4
  'Uniswap V4':      '#ff3399',
  // DEX — V3-style CL
  'Uniswap V3':      '#ff007a',
  'Aerodrome CL':    '#0052ff',  // Aerodrome brand blue
  'PancakeSwap V3':  '#1fc7d4',
  'SushiSwap V3':    '#fa52a0',
  'BaseSwap V3':     '#4a90e2',
  // DEX — V2-style AMM
  'Uniswap V2':      '#ff6da0',
  'Aerodrome':       '#0039b3',  // darker Aerodrome blue
  'PancakeSwap V2':  '#18a8b3',
  'SushiSwap V2':    '#e0478d',
  'BaseSwap V2':     '#3a78c9',
  'Alien Base V3':   '#7b42f6',
  'Solidly V3':      '#e8a020',
  'Equalizer':       '#00c896',
  'Hydrex':          '#2ec4f0',
  'Algebra':         '#6c3ce1',
  // DEX — other
  'Balancer V2':     '#aea8f5',
  // Lending
  'Aave V3':         '#b6509e',
  'Seamless':        '#5f4def',
  'Morpho Blue':     '#2470ff',
  'Euler':           '#e040fb',
  'Compound V3':     '#00d395',
  'Moonwell':        '#7cfc00',
  // Bridges
  'Base Bridge':     '#003fd1',
  'Across':          '#00d395',
  'Stargate V2':     '#f3a217',
  'CCTP':            '#00b4d8',
  'Chainlink CCIP':  '#375bd2',
  // Perps DEX
  'Avantis':         '#ff4500',
  'Wasabi':          '#9333ea',
  // Aggregators
  'KyberSwap':       '#31cb9e',
  'OpenOcean':       '#00d0ef',
  '0x Protocol':     '#231f20',
  // Fallback
  'Unknown':         '#555',
  'Unknown CL':      '#555',
  'Unknown AMM':     '#555',
}

// ── Protocol classification ────────────────────────────────────────────────
// Maps protocol name → UI group label. Unlisted protocols fall back to 'Other'.

// ── Known event topic hashes → human-readable event names ─────────────────
// Used by TopicTag to label log.topics[0] without a network lookup.

export const KNOWN_TOPICS: Record<string, string> = {
  [TRANSFER_TOPIC]:                    'Transfer',
  [APPROVAL_TOPIC]:                    'Approval',
  [WETH_DEPOSIT_TOPIC]:                'Deposit (wrap)',
  [WETH_WITHDRAWAL_TOPIC]:             'Withdrawal (unwrap)',
  [UNI_V3_SWAP_TOPIC]:                 'Swap (V3)',
  [PANCAKE_V3_SWAP_TOPIC]:             'Swap (V3)',
  [AMM_SWAP_TOPIC]:                    'Swap (AMM)',
  [AERODROME_AMM_SWAP_TOPIC]:          'Swap (AMM)',
  [AAVE_SUPPLY_TOPIC]:                 'Supply',
  [AAVE_WITHDRAW_TOPIC]:               'Withdraw',
  [AAVE_BORROW_TOPIC]:                 'Borrow',
  [AAVE_REPAY_TOPIC]:                  'Repay',
  [AAVE_LIQUIDATION_TOPIC]:            'LiquidationCall',
  [COMPOUND_MINT_TOPIC]:               'Mint',
  [COMPOUND_REDEEM_TOPIC]:             'Redeem',
  [COMPOUND_BORROW_TOPIC]:             'Borrow',
  [COMPOUND_REPAY_TOPIC]:              'RepayBorrow',
  [AMM_BURN_TOPIC]:                    'Burn',
  [UNI_V3_POOL_MINT_TOPIC]:            'Mint (V3)',
  [UNI_V3_POOL_BURN_TOPIC]:            'Burn (V3)',
  [UNI_V3_INCREASE_LIQ_TOPIC]:         'IncreaseLiquidity',
  [UNI_V3_DECREASE_LIQ_TOPIC]:         'DecreaseLiquidity',
  [UNI_V3_COLLECT_TOPIC]:              'Collect',
  [BALANCER_SWAP_TOPIC]:               'Swap (Balancer)',
  [MORPHO_SUPPLY_TOPIC]:               'Supply',
  [MORPHO_SUPPLY_COLLATERAL_TOPIC]:    'SupplyCollateral',
  [MORPHO_BORROW_TOPIC]:               'Borrow',
  [MORPHO_REPAY_TOPIC]:                'Repay',
  [MORPHO_WITHDRAW_TOPIC]:             'Withdraw',
  [MORPHO_WITHDRAW_COLLATERAL_TOPIC]:  'WithdrawCollateral',
  [MORPHO_LIQUIDATE_TOPIC]:            'Liquidate',
  [EULER_DEPOSIT_TOPIC]:               'Deposit',
  [EULER_WITHDRAW_TOPIC]:              'Withdraw',
  [EULER_BORROW_TOPIC]:                'Borrow',
  [EULER_REPAY_TOPIC]:                 'Repay',
  [COMPOUND3_SUPPLY_TOPIC]:            'Supply',
  [COMPOUND3_WITHDRAW_TOPIC]:          'Withdraw',
  [COMPOUND3_ABSORB_TOPIC]:            'AbsorbDebt',
  [AAVE_FLASH_LOAN_TOPIC]:             'FlashLoan',
  [MORPHO_FLASH_LOAN_TOPIC]:           'FlashLoan',
  [BALANCER_FLASH_LOAN_TOPIC]:         'FlashLoan',
  [L2_ERC20_BRIDGE_FINALIZED_TOPIC]:   'ERC20BridgeFinalized',
  [L2_ERC20_BRIDGE_INITIATED_TOPIC]:   'ERC20BridgeInitiated',
  [L2_ETH_BRIDGE_FINALIZED_TOPIC]:     'ETHBridgeFinalized',
  [L2_ETH_BRIDGE_INITIATED_TOPIC]:     'ETHBridgeInitiated',
  [L2_DEPOSIT_FINALIZED_TOPIC]:        'DepositFinalized',
  [L2_WITHDRAWAL_INITIATED_TOPIC]:     'WithdrawalInitiated',
  [ACROSS_FUNDS_DEPOSITED_TOPIC]:      'FundsDeposited',
  [ACROSS_FILLED_RELAY_TOPIC]:         'FilledRelay',
  [STARGATE_OFT_SENT_TOPIC]:           'OFTSent',
  [STARGATE_OFT_RECEIVED_TOPIC]:       'OFTReceived',
  [AVANTIS_MARKET_EXECUTED_TOPIC]:     'MarketExecuted',
  [AVANTIS_LIMIT_EXECUTED_TOPIC]:      'LimitExecuted',
  [WASABI_POSITION_OPENED_TOPIC]:            'PositionOpened',
  [WASABI_POSITION_CLOSED_TOPIC]:            'PositionClosed',
  [WASABI_POSITION_CLOSED_WITH_ORDER_TOPIC]: 'PositionClosedWithOrder',
  [WASABI_POSITION_LIQUIDATED_TOPIC]:        'PositionLiquidated',
  [WASABI_POSITION_INCREASED_TOPIC]:         'PositionIncreased',
  [WASABI_POSITION_DECREASED_TOPIC]:         'PositionDecreased',
  [KYBERSWAP_SWAPPED_TOPIC]:           'Swapped',
  [OPENOCEAN_SWAPPED_TOPIC]:           'Swapped',
  [ZEROX_TRANSFORMED_ERC20_TOPIC]:     'TransformedERC20',
  [UNI_V4_SWAP_TOPIC]:                 'Swap (V4)',
  [CCTP_DEPOSIT_FOR_BURN_TOPIC]:       'DepositForBurn',
  [CCTP_MINT_AND_WITHDRAW_TOPIC]:      'MintAndWithdraw',
  [CCIP_SEND_REQUESTED_TOPIC]:         'CCIPSendRequested',
  [CCIP_EXECUTION_STATE_CHANGED_TOPIC]: 'ExecutionStateChanged',
}

export const PROTOCOL_CLASSIFICATION: Record<string, string> = {
  // Concentrated Liquidity (tick-based CL AMMs)
  'Uniswap V4':      'Concentrated Liquidity',
  'Uniswap V3':      'Concentrated Liquidity',
  'Aerodrome CL':    'Concentrated Liquidity',
  'Unknown CL':      'Concentrated Liquidity',
  'PancakeSwap V3':  'Concentrated Liquidity',
  'SushiSwap V3':    'Concentrated Liquidity',
  'BaseSwap V3':     'Concentrated Liquidity',
  'Alien Base V3':   'Concentrated Liquidity',
  'Solidly V3':      'Concentrated Liquidity',
  'Hydrex':          'Concentrated Liquidity',
  'Algebra':         'Concentrated Liquidity',
  // Classic AMM (constant-product / Solidly-style)
  'Uniswap V2':      'Classic AMM',
  'Aerodrome':       'Classic AMM',
  'Unknown AMM':     'Classic AMM',
  'PancakeSwap V2':  'Classic AMM',
  'SushiSwap V2':    'Classic AMM',
  'BaseSwap V2':     'Classic AMM',
  'Equalizer':       'Classic AMM',
  'Balancer V2':     'Classic AMM',
  // Lending / money markets
  'Aave V3':         'Lending',
  'Seamless':        'Lending',
  'Morpho Blue':     'Lending',
  'Euler':           'Lending',
  'Compound V3':     'Lending',
  'Moonwell':        'Lending',
  // Bridges
  'Base Bridge':     'Bridge',
  'Across':          'Bridge',
  'Stargate V2':     'Bridge',
  'CCTP':            'Bridge',
  'Chainlink CCIP':  'Bridge',
  // Perps DEX
  'Avantis':         'Perps DEX',
  'Wasabi':          'Perps DEX',
  // Aggregators
  'KyberSwap':       'Aggregator',
  'OpenOcean':       'Aggregator',
  '0x Protocol':     'Aggregator',
}
