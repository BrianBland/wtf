// Lightweight ABI calldata decoder — no external dependencies

export interface AbiInput {
  name: string
  type: string
  components?: AbiInput[]  // for tuple and tuple[]
}

export interface AbiFn {
  name: string
  inputs: AbiInput[]
}

export type DecodedParam = {
  name: string
  type: string
  value: DecodedValue
}

export type DecodedValue =
  | { kind: 'address'; hex: string }
  | { kind: 'uint'; value: bigint; bits: number }
  | { kind: 'int'; value: bigint; bits: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'bytes_fixed'; hex: string; size: number }
  | { kind: 'bytes'; hex: string }
  | { kind: 'string'; value: string }
  | { kind: 'tuple'; fields: DecodedParam[] }
  | { kind: 'array'; elements: DecodedValue[]; elementType: string; total: number }
  | { kind: 'unknown'; type: string }

export type DecodedCall = {
  selector: string
  name: string
  params: DecodedParam[]
}

// ── Known function ABIs ────────────────────────────────────────────────────

const ABI_MAP: Record<string, AbiFn> = {
  // ERC20
  '0xa9059cbb': { name: 'transfer', inputs: [
    { name: 'to',    type: 'address' },
    { name: 'value', type: 'uint256' },
  ]},
  '0x23b872dd': { name: 'transferFrom', inputs: [
    { name: 'from',  type: 'address' },
    { name: 'to',    type: 'address' },
    { name: 'value', type: 'uint256' },
  ]},
  '0x095ea7b3': { name: 'approve', inputs: [
    { name: 'spender', type: 'address' },
    { name: 'value',   type: 'uint256' },
  ]},

  // WETH
  '0xd0e30db0': { name: 'deposit',  inputs: [] },
  '0x2e1a7d4d': { name: 'withdraw', inputs: [
    { name: 'wad', type: 'uint256' },
  ]},

  // Aave V3
  '0x617ba037': { name: 'supply', inputs: [
    { name: 'asset',       type: 'address' },
    { name: 'amount',      type: 'uint256' },
    { name: 'onBehalfOf',  type: 'address' },
    { name: 'referralCode', type: 'uint16' },
  ]},
  '0xa415bcad': { name: 'borrow', inputs: [
    { name: 'asset',            type: 'address' },
    { name: 'amount',           type: 'uint256' },
    { name: 'interestRateMode', type: 'uint256' },
    { name: 'referralCode',     type: 'uint16' },
    { name: 'onBehalfOf',       type: 'address' },
  ]},
  '0x573ade81': { name: 'repay', inputs: [
    { name: 'asset',            type: 'address' },
    { name: 'amount',           type: 'uint256' },
    { name: 'interestRateMode', type: 'uint256' },
    { name: 'onBehalfOf',       type: 'address' },
  ]},
  '0x94b576de': { name: 'repayWithATokens', inputs: [
    { name: 'asset',            type: 'address' },
    { name: 'amount',           type: 'uint256' },
    { name: 'interestRateMode', type: 'uint256' },
  ]},
  '0x69328dec': { name: 'withdraw', inputs: [
    { name: 'asset',  type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'to',     type: 'address' },
  ]},
  '0xe0232576': { name: 'liquidationCall', inputs: [
    { name: 'collateralAsset', type: 'address' },
    { name: 'debtAsset',       type: 'address' },
    { name: 'user',            type: 'address' },
    { name: 'debtToCover',     type: 'uint256' },
    { name: 'receiveAToken',   type: 'bool' },
  ]},

  // Uniswap V3 Router
  '0x04e45aaf': { name: 'exactInputSingle', inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'tokenIn',           type: 'address' },
    { name: 'tokenOut',          type: 'address' },
    { name: 'fee',               type: 'uint24' },
    { name: 'recipient',         type: 'address' },
    { name: 'amountIn',          type: 'uint256' },
    { name: 'amountOutMinimum',  type: 'uint256' },
    { name: 'sqrtPriceLimitX96', type: 'uint160' },
  ]}]},
  '0xdb3e2198': { name: 'exactOutputSingle', inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'tokenIn',           type: 'address' },
    { name: 'tokenOut',          type: 'address' },
    { name: 'fee',               type: 'uint24' },
    { name: 'recipient',         type: 'address' },
    { name: 'amountOut',         type: 'uint256' },
    { name: 'amountInMaximum',   type: 'uint256' },
    { name: 'sqrtPriceLimitX96', type: 'uint160' },
  ]}]},
  '0xb858183f': { name: 'exactInput', inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'path',             type: 'bytes' },
    { name: 'recipient',        type: 'address' },
    { name: 'amountIn',         type: 'uint256' },
    { name: 'amountOutMinimum', type: 'uint256' },
  ]}]},
  '0x09b81346': { name: 'exactOutput', inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'path',            type: 'bytes' },
    { name: 'recipient',       type: 'address' },
    { name: 'amountOut',       type: 'uint256' },
    { name: 'amountInMaximum', type: 'uint256' },
  ]}]},

  // Universal Router / multicall
  '0x3593564c': { name: 'execute', inputs: [
    { name: 'commands', type: 'bytes' },
    { name: 'inputs',   type: 'bytes[]' },
    { name: 'deadline', type: 'uint256' },
  ]},
  '0xac9650d8': { name: 'multicall', inputs: [
    { name: 'data', type: 'bytes[]' },
  ]},
  '0x5ae401dc': { name: 'multicall', inputs: [
    { name: 'deadline', type: 'uint256' },
    { name: 'data',     type: 'bytes[]' },
  ]},

  // Aerodrome / Velodrome router
  '0xdf440b60': { name: 'swapExactTokensForTokens', inputs: [
    { name: 'amountIn',     type: 'uint256' },
    { name: 'amountOutMin', type: 'uint256' },
    { name: 'routes', type: 'tuple[]', components: [
      { name: 'from',   type: 'address' },
      { name: 'to',     type: 'address' },
      { name: 'stable', type: 'bool' },
    ]},
    { name: 'to',       type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ]},
  '0x544cd4e0': { name: 'swapExactETHForTokens', inputs: [
    { name: 'amountOutMin', type: 'uint256' },
    { name: 'routes', type: 'tuple[]', components: [
      { name: 'from',   type: 'address' },
      { name: 'to',     type: 'address' },
      { name: 'stable', type: 'bool' },
    ]},
    { name: 'to',       type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ]},
  '0xe8e33700': { name: 'addLiquidity', inputs: [
    { name: 'tokenA',         type: 'address' },
    { name: 'tokenB',         type: 'address' },
    { name: 'stable',         type: 'bool' },
    { name: 'amountADesired', type: 'uint256' },
    { name: 'amountBDesired', type: 'uint256' },
    { name: 'amountAMin',     type: 'uint256' },
    { name: 'amountBMin',     type: 'uint256' },
    { name: 'to',             type: 'address' },
    { name: 'deadline',       type: 'uint256' },
  ]},
  '0xbaa2abde': { name: 'removeLiquidity', inputs: [
    { name: 'tokenA',    type: 'address' },
    { name: 'tokenB',    type: 'address' },
    { name: 'stable',    type: 'bool' },
    { name: 'liquidity', type: 'uint256' },
    { name: 'amountAMin', type: 'uint256' },
    { name: 'amountBMin', type: 'uint256' },
    { name: 'to',        type: 'address' },
    { name: 'deadline',  type: 'uint256' },
  ]},

  // Classic AMM (Uniswap V2 / SushiSwap / PancakeSwap V2)
  '0x7ff36ab5': { name: 'swapExactETHForTokens', inputs: [
    { name: 'amountOutMin', type: 'uint256' },
    { name: 'path',         type: 'address[]' },
    { name: 'to',           type: 'address' },
    { name: 'deadline',     type: 'uint256' },
  ]},
  '0x18cbafe5': { name: 'swapExactTokensForETH', inputs: [
    { name: 'amountIn',     type: 'uint256' },
    { name: 'amountOutMin', type: 'uint256' },
    { name: 'path',         type: 'address[]' },
    { name: 'to',           type: 'address' },
    { name: 'deadline',     type: 'uint256' },
  ]},
  '0x472b43f3': { name: 'swapExactTokensForTokens', inputs: [
    { name: 'amountIn',     type: 'uint256' },
    { name: 'amountOutMin', type: 'uint256' },
    { name: 'path',         type: 'address[]' },
    { name: 'to',           type: 'address' },
  ]},
  '0x42712a67': { name: 'swapTokensForExactTokens', inputs: [
    { name: 'amountOut',   type: 'uint256' },
    { name: 'amountInMax', type: 'uint256' },
    { name: 'path',        type: 'address[]' },
    { name: 'to',          type: 'address' },
  ]},
  '0xf305d719': { name: 'addLiquidityETH', inputs: [
    { name: 'token',              type: 'address' },
    { name: 'amountTokenDesired', type: 'uint256' },
    { name: 'amountTokenMin',     type: 'uint256' },
    { name: 'amountETHMin',       type: 'uint256' },
    { name: 'to',                 type: 'address' },
    { name: 'deadline',           type: 'uint256' },
  ]},
  '0x2195995c': { name: 'removeLiquidityWithPermit', inputs: [
    { name: 'tokenA',    type: 'address' },
    { name: 'tokenB',    type: 'address' },
    { name: 'liquidity', type: 'uint256' },
    { name: 'amountAMin', type: 'uint256' },
    { name: 'amountBMin', type: 'uint256' },
    { name: 'to',        type: 'address' },
    { name: 'deadline',  type: 'uint256' },
    { name: 'approveMax', type: 'bool' },
    { name: 'v',         type: 'uint8' },
    { name: 'r',         type: 'bytes32' },
    { name: 's',         type: 'bytes32' },
  ]},

  // Gnosis Safe
  '0x6a761202': { name: 'execTransaction', inputs: [
    { name: 'to',             type: 'address' },
    { name: 'value',          type: 'uint256' },
    { name: 'data',           type: 'bytes' },
    { name: 'operation',      type: 'uint8' },
    { name: 'safeTxGas',      type: 'uint256' },
    { name: 'baseGas',        type: 'uint256' },
    { name: 'gasPrice',       type: 'uint256' },
    { name: 'gasToken',       type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'signatures',     type: 'bytes' },
  ]},
}

// ── ABI encoding helpers ───────────────────────────────────────────────────

function readSlot(data: Uint8Array, byteOffset: number): bigint {
  let v = 0n
  for (let i = 0; i < 32; i++) {
    v = (v << 8n) | BigInt(data[byteOffset + i] ?? 0)
  }
  return v
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function isDynamic(type: string, components?: AbiInput[]): boolean {
  if (type === 'bytes' || type === 'string') return true
  if (type.endsWith('[]')) return true
  if (type === 'tuple' && components) return components.some((c) => isDynamic(c.type, c.components))
  return false
}

// Returns the number of bytes this type's head occupies in its parent encoding
function headSize(type: string, components?: AbiInput[]): number {
  if (isDynamic(type, components)) return 32  // offset pointer
  if (type === 'tuple' && components) {
    return components.reduce((sum, c) => sum + headSize(c.type, c.components), 0)
  }
  return 32  // all basic static types: uint/int/address/bool/bytesN
}

// ── Core decoder ───────────────────────────────────────────────────────────

/**
 * Decode a single ABI-encoded value.
 *
 * @param data         The full calldata buffer (without 4-byte selector)
 * @param type         Solidity type string
 * @param components   Tuple field definitions (for tuple / tuple[])
 * @param headOffset   Byte offset of this value's head slot within `data`
 * @param base         Byte offset of the start of the current encoding context
 *                     (used to resolve offset pointers for dynamic types)
 */
function decodeValue(
  data: Uint8Array,
  type: string,
  components: AbiInput[] | undefined,
  headOffset: number,
  base: number,
): DecodedValue {
  try {
    if (headOffset > data.length) return { kind: 'unknown', type }

    if (type === 'address') {
      if (headOffset + 32 > data.length) return { kind: 'unknown', type }
      return { kind: 'address', hex: '0x' + toHex(data.slice(headOffset + 12, headOffset + 32)) }
    }

    if (type === 'bool') {
      return { kind: 'bool', value: (data[headOffset + 31] ?? 0) !== 0 }
    }

    if (type.startsWith('uint')) {
      const bits = parseInt(type.slice(4)) || 256
      const raw = readSlot(data, headOffset)
      const value = bits < 256 ? raw & ((1n << BigInt(bits)) - 1n) : raw
      return { kind: 'uint', value, bits }
    }

    if (type.startsWith('int')) {
      const bits = parseInt(type.slice(3)) || 256
      const raw = readSlot(data, headOffset)
      const halfRange = 1n << BigInt(bits - 1)
      const fullRange = 1n << BigInt(bits)
      const masked = bits < 256 ? raw & (fullRange - 1n) : raw
      const value = masked >= halfRange ? masked - fullRange : masked
      return { kind: 'int', value, bits }
    }

    if (type === 'bytes') {
      const offset = Number(readSlot(data, headOffset))
      const dataPos = base + offset
      if (dataPos + 32 > data.length) return { kind: 'bytes', hex: '0x' }
      const length = Number(readSlot(data, dataPos))
      return { kind: 'bytes', hex: '0x' + toHex(data.slice(dataPos + 32, dataPos + 32 + length)) }
    }

    if (type === 'string') {
      const offset = Number(readSlot(data, headOffset))
      const dataPos = base + offset
      if (dataPos + 32 > data.length) return { kind: 'string', value: '' }
      const length = Number(readSlot(data, dataPos))
      const bytes = data.slice(dataPos + 32, dataPos + 32 + length)
      return { kind: 'string', value: new TextDecoder().decode(bytes) }
    }

    if (type.startsWith('bytes') && type !== 'bytes') {
      // Fixed-size bytesN
      const size = parseInt(type.slice(5))
      return { kind: 'bytes_fixed', hex: '0x' + toHex(data.slice(headOffset, headOffset + size)), size }
    }

    if (type === 'tuple' && components) {
      const dynamic = components.some((c) => isDynamic(c.type, c.components))

      let tupleStart: number
      let tupleBase: number
      if (dynamic) {
        const offset = Number(readSlot(data, headOffset))
        tupleBase = base + offset
        tupleStart = tupleBase
      } else {
        tupleBase = headOffset
        tupleStart = headOffset
      }

      const fields: DecodedParam[] = []
      let fieldOffset = tupleStart
      for (const comp of components) {
        const value = decodeValue(data, comp.type, comp.components, fieldOffset, tupleBase)
        fields.push({ name: comp.name, type: comp.type, value })
        fieldOffset += headSize(comp.type, comp.components)
      }
      return { kind: 'tuple', fields }
    }

    if (type.endsWith('[]')) {
      const elemType = type.slice(0, -2)
      // For tuple[], components describes the tuple element's fields
      const elemComponents = elemType === 'tuple' ? components : undefined

      const offset = Number(readSlot(data, headOffset))
      const arrBase = base + offset
      if (arrBase + 32 > data.length) return { kind: 'array', elements: [], elementType: elemType, total: 0 }

      const total = Number(readSlot(data, arrBase))
      const elemSize = headSize(elemType, elemComponents)
      const limit = Math.min(total, 20)
      const elements: DecodedValue[] = []

      for (let i = 0; i < limit; i++) {
        const elemOffset = arrBase + 32 + i * elemSize
        elements.push(decodeValue(data, elemType, elemComponents, elemOffset, arrBase + 32))
      }
      return { kind: 'array', elements, elementType: elemType, total }
    }

    return { kind: 'unknown', type }
  } catch {
    return { kind: 'unknown', type }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export function decodeCalldata(input: string, selector: string): DecodedCall | null {
  const abi = ABI_MAP[selector.toLowerCase()]
  if (!abi || !input || input.length < 10) return null

  try {
    const hex = input.startsWith('0x') ? input.slice(2) : input
    const rawBytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < rawBytes.length; i++) {
      rawBytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    }
    const data = rawBytes.slice(4)  // skip 4-byte selector

    const params: DecodedParam[] = []
    let headOffset = 0

    for (const inp of abi.inputs) {
      const value = decodeValue(data, inp.type, inp.components, headOffset, 0)
      params.push({ name: inp.name, type: inp.type, value })
      headOffset += headSize(inp.type, inp.components)
    }

    return { selector, name: abi.name, params }
  } catch {
    return null
  }
}

export { ABI_MAP }
