// Known Base chain addresses, tokens, protocols, and event signatures

export interface TokenInfo {
  symbol: string
  decimals: number
  color: string
}

export const KNOWN_TOKENS: Record<string, TokenInfo> = {
  '0x4200000000000000000000000000000000000006': { symbol: 'WETH',   decimals: 18, color: '#627eea' },
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC',   decimals: 6,  color: '#2775ca' },
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { symbol: 'cbBTC',  decimals: 8,  color: '#f7931a' },
  '0x940181a94a35a4569e4529a3cdfb74e38fd98631': { symbol: 'AERO',   decimals: 18, color: '#00c4e0' },
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { symbol: 'DAI',    decimals: 18, color: '#f5ac37' },
  '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': { symbol: 'cbETH',  decimals: 18, color: '#4888f0' },
  '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': { symbol: 'wstETH', decimals: 18, color: '#00a3ff' },
  '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a': { symbol: 'weETH',  decimals: 18, color: '#24b76a' },
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': { symbol: 'USDbC',  decimals: 6,  color: '#1a8fe3' },
  '0xab36452dbac151be02b16ca17d8919826072f64a': { symbol: 'rETH',   decimals: 18, color: '#ff6b35' },
  '0x0000000000000000000000000000000000000000': { symbol: 'ETH',    decimals: 18, color: '#627eea' },
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
  // Stargate
  '0x45f1a95a4d3f3836523f5c83673c797f4d4d263b': { name: 'Stargate USDC Pool',        type: 'bridge' },
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
export const WETH_ADDRESS  = '0x4200000000000000000000000000000000000006'
export const CBBTC_ADDRESS = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'

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
  // Misc
  '0x1cff79cd': 'execute',
  '0x6a761202': 'execTransaction', // Gnosis Safe
}

// ERC20 Transfer — topic0
export const TRANSFER_TOPIC   = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
export const APPROVAL_TOPIC   = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'
// Uniswap V3 Swap(address,address,int256,int256,uint160,uint128,int24)
export const UNI_V3_SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'
// Aerodrome / classic AMM Swap(address,uint,uint,uint,uint,address)
export const AMM_SWAP_TOPIC   = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
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
