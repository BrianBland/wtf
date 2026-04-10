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

  // ERC-4337 EntryPoint v0.6 — UserOperation
  '0x1fad948c': { name: 'handleOps', inputs: [
    { name: 'ops', type: 'tuple[]', components: [
      { name: 'sender',               type: 'address' },
      { name: 'nonce',                type: 'uint256' },
      { name: 'initCode',             type: 'bytes'   },
      { name: 'callData',             type: 'bytes'   },
      { name: 'callGasLimit',         type: 'uint256' },
      { name: 'verificationGasLimit', type: 'uint256' },
      { name: 'preVerificationGas',   type: 'uint256' },
      { name: 'maxFeePerGas',         type: 'uint256' },
      { name: 'maxPriorityFeePerGas', type: 'uint256' },
      { name: 'paymasterAndData',     type: 'bytes'   },
      { name: 'signature',            type: 'bytes'   },
    ]},
    { name: 'beneficiary', type: 'address' },
  ]},

  // ERC-4337 EntryPoint v0.7 — PackedUserOperation
  '0x765e827f': { name: 'handleOps', inputs: [
    { name: 'ops', type: 'tuple[]', components: [
      { name: 'sender',           type: 'address' },
      { name: 'nonce',            type: 'uint256' },
      { name: 'initCode',         type: 'bytes'   },
      { name: 'callData',         type: 'bytes'   },
      { name: 'accountGasLimits', type: 'bytes32' }, // verificationGasLimit (upper 16) | callGasLimit (lower 16)
      { name: 'preVerificationGas', type: 'uint256' },
      { name: 'gasFees',          type: 'bytes32' }, // maxPriorityFeePerGas (upper 16) | maxFeePerGas (lower 16)
      { name: 'paymasterAndData', type: 'bytes'   },
      { name: 'signature',        type: 'bytes'   },
    ]},
    { name: 'beneficiary', type: 'address' },
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

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(Math.ceil(h.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

function readSlot(data: Uint8Array, byteOffset: number): bigint {
  let v = 0n
  for (let i = 0; i < 32; i++) {
    v = (v << 8n) | BigInt(data[byteOffset + i] ?? 0)
  }
  return v
}

function readSlotNumber(data: Uint8Array, byteOffset: number): number | null {
  if (byteOffset < 0 || byteOffset + 32 > data.length) return null
  const value = readSlot(data, byteOffset)
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null
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

function resolveDynamicOffset(data: Uint8Array, headOffset: number, base: number): number | null {
  const offset = readSlotNumber(data, headOffset)
  if (offset === null || offset % 32 !== 0) return null
  const absolute = base + offset
  return absolute >= base && absolute <= data.length ? absolute : null
}

function validateValueShape(
  data: Uint8Array,
  type: string,
  components: AbiInput[] | undefined,
  headOffset: number,
  base: number,
): boolean {
  if (headOffset < 0) return false

  if (
    type === 'address'
    || type === 'bool'
    || type.startsWith('uint')
    || type.startsWith('int')
    || (type.startsWith('bytes') && type !== 'bytes')
  ) {
    return headOffset + 32 <= data.length
  }

  if (type === 'bytes' || type === 'string') {
    const dataPos = resolveDynamicOffset(data, headOffset, base)
    if (dataPos === null) return false
    const length = readSlotNumber(data, dataPos)
    if (length === null) return false
    const paddedLength = Math.ceil(length / 32) * 32
    return dataPos + 32 + paddedLength <= data.length
  }

  if (type === 'tuple' && components) {
    const tupleBase = isDynamic(type, components)
      ? resolveDynamicOffset(data, headOffset, base)
      : headOffset
    if (tupleBase === null) return false

    let fieldOffset = tupleBase
    for (const comp of components) {
      if (!validateValueShape(data, comp.type, comp.components, fieldOffset, tupleBase)) return false
      fieldOffset += headSize(comp.type, comp.components)
    }
    return true
  }

  if (type.endsWith('[]')) {
    const elemType = type.slice(0, -2)
    const elemComponents = elemType === 'tuple' ? components : undefined
    const arrBase = resolveDynamicOffset(data, headOffset, base)
    if (arrBase === null || arrBase + 32 > data.length) return false

    const total = readSlotNumber(data, arrBase)
    if (total === null) return false

    const elemSize = headSize(elemType, elemComponents)
    const elementsBase = arrBase + 32
    const headEnd = elementsBase + total * elemSize
    if (headEnd > data.length) return false

    for (let i = 0; i < total; i++) {
      const elemOffset = elementsBase + i * elemSize
      if (!validateValueShape(data, elemType, elemComponents, elemOffset, elementsBase)) return false
    }
    return true
  }

  return false
}

function isHexInput(input: string): boolean {
  return /^0x[0-9a-fA-F]*$/.test(input) && input.length % 2 === 0
}

function validateCallShape(input: string, inputs: AbiInput[]): Uint8Array | null {
  if (!input || input.length < 10 || !isHexInput(input)) return null

  const data = hexToBytes(input).slice(4)
  const totalHead = inputs.reduce((sum, inp) => sum + headSize(inp.type, inp.components), 0)
  if (data.length < totalHead) return null
  if (inputs.length === 0) return data.length === 0 ? data : null

  let headOffset = 0
  for (const inp of inputs) {
    if (!validateValueShape(data, inp.type, inp.components, headOffset, 0)) return null
    headOffset += headSize(inp.type, inp.components)
  }

  return data
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

/** Recursively parse a text-signature params string into AbiInput[].
 *  Tuples are written as (type1,type2,...) in canonical ABI text form. */
function parseSigToInputs(paramsStr: string): AbiInput[] {
  if (!paramsStr) return []
  return splitTopLevel(paramsStr).map((t, i) => {
    const trimmed = t.trim()
    if (trimmed.startsWith('(')) {
      const closeIdx = trimmed.lastIndexOf(')')
      const inner    = trimmed.slice(1, closeIdx)
      const suffix   = trimmed.slice(closeIdx + 1)   // e.g. '' | '[]' | '[5]'
      return { name: `field${i}`, type: suffix ? `tuple${suffix}` : 'tuple', components: parseSigToInputs(inner) }
    }
    return { name: `arg${i}`, type: trimmed }
  })
}

/** Decode calldata using a full text signature from Sourcify/4byte.
 *  Param names default to arg0, arg1, … since the text sig has no names. */
export function decodeCalldataFromSig(input: string, sig: string): DecodedCall | null {
  const m = sig.match(/^([A-Za-z0-9_$]+)\((.*)\)$/)
  if (!m || !input || input.length < 10) return null
  const [, name, paramsStr] = m
  try {
    const inputs = parseSigToInputs(paramsStr)
    const data = validateCallShape(input, inputs)
    if (!data) return null

    const params: DecodedParam[] = []
    let headOffset = 0
    for (const inp of inputs) {
      params.push({ name: inp.name, type: inp.type, value: decodeValue(data, inp.type, inp.components, headOffset, 0) })
      headOffset += headSize(inp.type, inp.components)
    }
    return { selector: input.slice(0, 10).toLowerCase(), name, params }
  } catch {
    return null
  }
}

export function decodeCalldata(input: string, selector: string): DecodedCall | null {
  const abi = ABI_MAP[selector.toLowerCase()]
  if (!abi) return null

  try {
    const data = validateCallShape(input, abi.inputs)
    if (!data) return null

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

export function hasKnownFunctionAbi(selector: string): boolean {
  return selector.toLowerCase() in ABI_MAP
}

export function selectorMatchesKnownAbi(selector: string, inputHex: string): boolean {
  return decodeCalldata(inputHex, selector) !== null
}

/** Returns true if the text signature is plausibly compatible with the given calldata.
 *  Used to filter out selector-collision false positives from 4byte.directory. */
export function sigMatchesCalldata(sig: string, inputHex: string): boolean {
  return decodeCalldataFromSig(inputHex, sig) !== null
}

// ── Event types ────────────────────────────────────────────────────────────

export interface AbiEventInput extends AbiInput {
  indexed: boolean
}

export interface AbiEvent {
  name: string
  inputs: AbiEventInput[]
}

export interface DecodedLog {
  name: string
  params: Array<{ name: string; type: string; indexed: boolean; value: DecodedValue }>
}

// ── Known event ABIs (keyed by topic0 hash) ────────────────────────────────

export const EVENT_ABI_MAP: Record<string, AbiEvent> = {
  // WETH wrap/unwrap
  '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c': { name: 'Deposit', inputs: [
    { name: 'dst', type: 'address', indexed: true  },
    { name: 'wad', type: 'uint256', indexed: false },
  ]},
  '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65': { name: 'Withdrawal', inputs: [
    { name: 'src', type: 'address', indexed: true  },
    { name: 'wad', type: 'uint256', indexed: false },
  ]},
  // ERC20
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': { name: 'Transfer', inputs: [
    { name: 'from',  type: 'address', indexed: true  },
    { name: 'to',    type: 'address', indexed: true  },
    { name: 'value', type: 'uint256', indexed: false },
  ]},
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925': { name: 'Approval', inputs: [
    { name: 'owner',   type: 'address', indexed: true  },
    { name: 'spender', type: 'address', indexed: true  },
    { name: 'value',   type: 'uint256', indexed: false },
  ]},
  // Uniswap V3 pool Swap
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67': { name: 'Swap', inputs: [
    { name: 'sender',       type: 'address', indexed: true  },
    { name: 'recipient',    type: 'address', indexed: true  },
    { name: 'amount0',      type: 'int256',  indexed: false },
    { name: 'amount1',      type: 'int256',  indexed: false },
    { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
    { name: 'liquidity',    type: 'uint128', indexed: false },
    { name: 'tick',         type: 'int24',   indexed: false },
  ]},
  // AMM (Uniswap V2 / Aerodrome classic) Swap
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822': { name: 'Swap', inputs: [
    { name: 'sender',     type: 'address', indexed: true  },
    { name: 'amount0In',  type: 'uint256', indexed: false },
    { name: 'amount1In',  type: 'uint256', indexed: false },
    { name: 'amount0Out', type: 'uint256', indexed: false },
    { name: 'amount1Out', type: 'uint256', indexed: false },
    { name: 'to',         type: 'address', indexed: true  },
  ]},
  // AMM Burn
  '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4cf2e500068de590b6f': { name: 'Burn', inputs: [
    { name: 'sender',  type: 'address', indexed: true  },
    { name: 'amount0', type: 'uint256', indexed: false },
    { name: 'amount1', type: 'uint256', indexed: false },
    { name: 'to',      type: 'address', indexed: true  },
  ]},
  // Uniswap V3 / CL pool Mint
  '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde': { name: 'Mint', inputs: [
    { name: 'sender',    type: 'address', indexed: false },
    { name: 'owner',     type: 'address', indexed: true  },
    { name: 'tickLower', type: 'int24',   indexed: true  },
    { name: 'tickUpper', type: 'int24',   indexed: true  },
    { name: 'amount',    type: 'uint128', indexed: false },
    { name: 'amount0',   type: 'uint256', indexed: false },
    { name: 'amount1',   type: 'uint256', indexed: false },
  ]},
  // Uniswap V3 / CL pool Burn
  '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c': { name: 'Burn', inputs: [
    { name: 'owner',     type: 'address', indexed: true  },
    { name: 'tickLower', type: 'int24',   indexed: true  },
    { name: 'tickUpper', type: 'int24',   indexed: true  },
    { name: 'amount',    type: 'uint128', indexed: false },
    { name: 'amount0',   type: 'uint256', indexed: false },
    { name: 'amount1',   type: 'uint256', indexed: false },
  ]},
  // Uniswap V3 NonfungiblePositionManager
  '0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35c': { name: 'IncreaseLiquidity', inputs: [
    { name: 'tokenId',   type: 'uint256', indexed: true  },
    { name: 'liquidity', type: 'uint128', indexed: false },
    { name: 'amount0',   type: 'uint256', indexed: false },
    { name: 'amount1',   type: 'uint256', indexed: false },
  ]},
  '0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4': { name: 'DecreaseLiquidity', inputs: [
    { name: 'tokenId',   type: 'uint256', indexed: true  },
    { name: 'liquidity', type: 'uint128', indexed: false },
    { name: 'amount0',   type: 'uint256', indexed: false },
    { name: 'amount1',   type: 'uint256', indexed: false },
  ]},
  '0x40d0efd1a53d60ecbf40971b9daf7dc90178c3eff3b3f722c8d5fdd96b56f8c9': { name: 'Collect', inputs: [
    { name: 'tokenId',          type: 'uint256', indexed: true  },
    { name: 'recipient',        type: 'address', indexed: false },
    { name: 'amount0Collected', type: 'uint256', indexed: false },
    { name: 'amount1Collected', type: 'uint256', indexed: false },
  ]},
  // Balancer V2 Swap
  '0x2170c741c41531aec20e7c107c24eecfdd15e69c9bb0a8dd37b1840b9e0b207b': { name: 'Swap', inputs: [
    { name: 'poolId',    type: 'bytes32', indexed: true  },
    { name: 'tokenIn',   type: 'address', indexed: true  },
    { name: 'tokenOut',  type: 'address', indexed: true  },
    { name: 'amountIn',  type: 'uint256', indexed: false },
    { name: 'amountOut', type: 'uint256', indexed: false },
  ]},
  // Aave V3
  '0x2b627736bca15cd5381dcf80b0bf11fd197d01a037c52b927a881a10fb73ba61': { name: 'Supply', inputs: [
    { name: 'reserve',      type: 'address', indexed: true  },
    { name: 'user',         type: 'address', indexed: false },
    { name: 'onBehalfOf',   type: 'address', indexed: true  },
    { name: 'amount',       type: 'uint256', indexed: false },
    { name: 'referralCode', type: 'uint16',  indexed: true  },
  ]},
  '0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7': { name: 'Withdraw', inputs: [
    { name: 'reserve', type: 'address', indexed: true  },
    { name: 'user',    type: 'address', indexed: true  },
    { name: 'to',      type: 'address', indexed: true  },
    { name: 'amount',  type: 'uint256', indexed: false },
  ]},
  '0xc6a898309e823ee50bac64e45ca8adba6690e99e7841c45d754785487320f9ce': { name: 'Borrow', inputs: [
    { name: 'reserve',          type: 'address', indexed: true  },
    { name: 'user',             type: 'address', indexed: false },
    { name: 'onBehalfOf',       type: 'address', indexed: true  },
    { name: 'amount',           type: 'uint256', indexed: false },
    { name: 'interestRateMode', type: 'uint8',   indexed: false },
    { name: 'borrowRate',       type: 'uint128', indexed: false },
    { name: 'referralCode',     type: 'uint16',  indexed: true  },
  ]},
  '0xa534c8dbe71f871f9f3530e97a74601fea17b426cae02e1c5aee42c96c784051': { name: 'Repay', inputs: [
    { name: 'reserve',    type: 'address', indexed: true  },
    { name: 'user',       type: 'address', indexed: true  },
    { name: 'repayer',    type: 'address', indexed: true  },
    { name: 'amount',     type: 'uint256', indexed: false },
    { name: 'useATokens', type: 'bool',    indexed: false },
  ]},
  '0xe413a321e8681d831f4dbccbeca18f7eab7cf8d0a5c8ead7f3ba01b35d4b9e7': { name: 'LiquidationCall', inputs: [
    { name: 'collateralAsset',       type: 'address', indexed: true  },
    { name: 'debtAsset',             type: 'address', indexed: true  },
    { name: 'user',                  type: 'address', indexed: true  },
    { name: 'debtToCover',           type: 'uint256', indexed: false },
    { name: 'liquidatedCollateral',  type: 'uint256', indexed: false },
    { name: 'liquidator',            type: 'address', indexed: false },
    { name: 'receiveAToken',         type: 'bool',    indexed: false },
  ]},
  '0x631042c832b07452973831137f2d73e395028b44b250dedc5abb0ee766e168ac': { name: 'FlashLoan', inputs: [
    { name: 'target',           type: 'address', indexed: true  },
    { name: 'initiator',        type: 'address', indexed: true  },
    { name: 'asset',            type: 'address', indexed: true  },
    { name: 'amount',           type: 'uint256', indexed: false },
    { name: 'interestRateMode', type: 'uint8',   indexed: false },
    { name: 'premium',          type: 'uint256', indexed: false },
    { name: 'referralCode',     type: 'uint16',  indexed: false },
  ]},
  // Morpho Blue
  '0xedf8870433c83823eb071d3df1caa8d008f12f6440918c20d75a3602cda30fe0': { name: 'Supply', inputs: [
    { name: 'id',       type: 'bytes32', indexed: true  },
    { name: 'caller',   type: 'address', indexed: true  },
    { name: 'onBehalf', type: 'address', indexed: true  },
    { name: 'assets',   type: 'uint256', indexed: false },
    { name: 'shares',   type: 'uint256', indexed: false },
  ]},
  '0xa3b9472a1399e17e123f3c2e6586c23e504184d504de59cdaa2b375e880c6184': { name: 'SupplyCollateral', inputs: [
    { name: 'id',       type: 'bytes32', indexed: true  },
    { name: 'caller',   type: 'address', indexed: true  },
    { name: 'onBehalf', type: 'address', indexed: true  },
    { name: 'assets',   type: 'uint256', indexed: false },
  ]},
  '0x570954540bed6b1304a87dfe815a5eda4a648f7097a16240dcd85c9b5fd42a43': { name: 'Borrow', inputs: [
    { name: 'id',       type: 'bytes32', indexed: true  },
    { name: 'caller',   type: 'address', indexed: false },
    { name: 'onBehalf', type: 'address', indexed: true  },
    { name: 'receiver', type: 'address', indexed: true  },
    { name: 'assets',   type: 'uint256', indexed: false },
    { name: 'shares',   type: 'uint256', indexed: false },
  ]},
  '0x52acb05cebbd3cd39715469f22afbf5a17496295ef3bc9bb5944056c63ccaa09': { name: 'Repay', inputs: [
    { name: 'id',       type: 'bytes32', indexed: true  },
    { name: 'caller',   type: 'address', indexed: true  },
    { name: 'onBehalf', type: 'address', indexed: true  },
    { name: 'assets',   type: 'uint256', indexed: false },
    { name: 'shares',   type: 'uint256', indexed: false },
  ]},
  '0xa56fc0ad5702ec05ce63666221f796fb62437c32db1aa1aa075fc6484cf58fbf': { name: 'Withdraw', inputs: [
    { name: 'id',       type: 'bytes32', indexed: true  },
    { name: 'caller',   type: 'address', indexed: false },
    { name: 'onBehalf', type: 'address', indexed: true  },
    { name: 'receiver', type: 'address', indexed: true  },
    { name: 'assets',   type: 'uint256', indexed: false },
    { name: 'shares',   type: 'uint256', indexed: false },
  ]},
  '0xe80ebd7cc9223d7382aab2e0d1d6155c65651f83d53c8b9b06901d167e321142': { name: 'WithdrawCollateral', inputs: [
    { name: 'id',       type: 'bytes32', indexed: true  },
    { name: 'caller',   type: 'address', indexed: false },
    { name: 'onBehalf', type: 'address', indexed: true  },
    { name: 'receiver', type: 'address', indexed: true  },
    { name: 'assets',   type: 'uint256', indexed: false },
  ]},
  '0xa4946ede45d0c6f06a0f5ce92c9ad3b4751452d2fe0e25010783bcab57a67e41': { name: 'Liquidate', inputs: [
    { name: 'id',              type: 'bytes32', indexed: true  },
    { name: 'caller',          type: 'address', indexed: true  },
    { name: 'borrower',        type: 'address', indexed: true  },
    { name: 'repaidAssets',    type: 'uint256', indexed: false },
    { name: 'repaidShares',    type: 'uint256', indexed: false },
    { name: 'seizedAssets',    type: 'uint256', indexed: false },
    { name: 'badDebtAssets',   type: 'uint256', indexed: false },
    { name: 'badDebtShares',   type: 'uint256', indexed: false },
  ]},
  '0xc76f1b4fe4396ac07a9fa55a415d4ca430e72651d37d3401f3bed7cb13fc4f12': { name: 'FlashLoan', inputs: [
    { name: 'caller', type: 'address', indexed: true  },
    { name: 'token',  type: 'address', indexed: true  },
    { name: 'assets', type: 'uint256', indexed: false },
  ]},
  // Euler V2
  '0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7': { name: 'Deposit', inputs: [
    { name: 'caller', type: 'address', indexed: true  },
    { name: 'owner',  type: 'address', indexed: true  },
    { name: 'assets', type: 'uint256', indexed: false },
    { name: 'shares', type: 'uint256', indexed: false },
  ]},
  '0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db': { name: 'Withdraw', inputs: [
    { name: 'caller',   type: 'address', indexed: true  },
    { name: 'receiver', type: 'address', indexed: true  },
    { name: 'owner',    type: 'address', indexed: true  },
    { name: 'assets',   type: 'uint256', indexed: false },
    { name: 'shares',   type: 'uint256', indexed: false },
  ]},
  '0xcbc04eca7e9da35cb1393a6135a199ca52e450d5e9251cbd99f7847d33a36750': { name: 'Borrow', inputs: [
    { name: 'account', type: 'address', indexed: true  },
    { name: 'assets',  type: 'uint256', indexed: false },
  ]},
  '0x5c16de4f8b59bd9caf0f49a545f25819a895ed223294290b408242e72a594231': { name: 'Repay', inputs: [
    { name: 'account', type: 'address', indexed: true  },
    { name: 'assets',  type: 'uint256', indexed: false },
  ]},
  // Compound V3
  '0xd1cf3d156d5f8f0d50f6c122ed609cec09d35c9b9fb3fff6ea0959134dae424e': { name: 'Supply', inputs: [
    { name: 'from',   type: 'address', indexed: true  },
    { name: 'dst',    type: 'address', indexed: true  },
    { name: 'amount', type: 'uint256', indexed: false },
  ]},
  '0x9b1bfa7fa9ee420a16e124f794c35ac9f90472acc99140eb2f6447c714cad8eb': { name: 'Withdraw', inputs: [
    { name: 'src',    type: 'address', indexed: true  },
    { name: 'to',     type: 'address', indexed: true  },
    { name: 'amount', type: 'uint256', indexed: false },
  ]},
  '0x1547a878dc89ad3c367b6338b4be6a65a5dd74fb77ae044da1e8747ef1f4f62f': { name: 'AbsorbDebt', inputs: [
    { name: 'absorber',   type: 'address', indexed: true  },
    { name: 'borrower',   type: 'address', indexed: true  },
    { name: 'basePaidOut', type: 'uint256', indexed: false },
    { name: 'usdValue',    type: 'uint256', indexed: false },
  ]},
  // Moonwell / Compound V2
  '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f': { name: 'Mint', inputs: [
    { name: 'minter',     type: 'address', indexed: false },
    { name: 'mintAmount', type: 'uint256', indexed: false },
    { name: 'mintTokens', type: 'uint256', indexed: false },
  ]},
  '0xe5b754fb1abb7f01b499791d0b820ae3b6af3424ac1c59768edb53f4ec31a929': { name: 'Redeem', inputs: [
    { name: 'redeemer',      type: 'address', indexed: false },
    { name: 'redeemAmount',  type: 'uint256', indexed: false },
    { name: 'redeemTokens',  type: 'uint256', indexed: false },
  ]},
  '0x13ed6866d4e1ee6da46f845c46d7e54120883d75c5ea9a2dacc1c4ca8984ab80': { name: 'Borrow', inputs: [
    { name: 'borrower',          type: 'address', indexed: false },
    { name: 'borrowAmount',      type: 'uint256', indexed: false },
    { name: 'accountBorrows',    type: 'uint256', indexed: false },
    { name: 'totalBorrows',      type: 'uint256', indexed: false },
  ]},
  '0x1a2a22cb034d26d1854bdc6a1da3f587a5e8bb8e7ac2b96cb5b9c70620d8bc8a': { name: 'RepayBorrow', inputs: [
    { name: 'payer',             type: 'address', indexed: false },
    { name: 'borrower',          type: 'address', indexed: false },
    { name: 'repayAmount',       type: 'uint256', indexed: false },
    { name: 'accountBorrows',    type: 'uint256', indexed: false },
    { name: 'totalBorrows',      type: 'uint256', indexed: false },
  ]},
  // Balancer FlashLoan
  '0x0d7d75e01ab95780d3cd1c8ec0dd6c2ce19e3a20427eec8bf53283b6fb8e95f0': { name: 'FlashLoan', inputs: [
    { name: 'recipient',  type: 'address', indexed: true  },
    { name: 'token',      type: 'address', indexed: true  },
    { name: 'amount',     type: 'uint256', indexed: false },
    { name: 'feeAmount',  type: 'uint256', indexed: false },
  ]},
}

// ── Log decoding ───────────────────────────────────────────────────────────

/** Split a top-level comma-separated param string, respecting nested parens. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = []
  let depth = 0, current = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(current); current = '' }
    else current += ch
  }
  if (current) parts.push(current)
  return parts
}

/**
 * Parse a Sourcify text signature into AbiEventInput[] using a heuristic:
 * the first `indexedCount` params are treated as indexed (they appear in topics[1..]).
 * This matches most common events but may be wrong when non-indexed params
 * precede indexed ones (e.g. Uniswap V3 Mint's `sender` param).
 * For those events the explicit EVENT_ABI_MAP takes precedence.
 */
function parseEventSig(sig: string, indexedCount: number): AbiEventInput[] | null {
  const m = sig.match(/^[A-Za-z0-9_$]+\((.*)\)$/)
  if (!m) return null
  const inner = m[1]
  if (!inner) return []
  return splitTopLevel(inner).map((t, i) => ({
    name: `arg${i}`,
    type: t.trim().replace(/\s+indexed/, ''),
    indexed: i < indexedCount,
  }))
}

/** Decode a single 32-byte indexed topic into a DecodedValue.
 *  Dynamic types (bytes/string/arrays) are stored as keccak256 hashes — returned as bytes32. */
function decodeIndexedTopic(topic: string, type: string, components?: AbiInput[]): DecodedValue {
  if (type === 'bytes' || type === 'string' || type.endsWith('[]') || type === 'tuple') {
    return { kind: 'bytes_fixed', hex: topic, size: 32 }
  }
  try {
    return decodeValue(hexToBytes(topic), type, components, 0, 0)
  } catch {
    return { kind: 'bytes_fixed', hex: topic, size: 32 }
  }
}

/**
 * Decode a log entry.
 * Uses EVENT_ABI_MAP for known events; falls back to parsing `dynamicSig`
 * (full text signature from Sourcify) with an indexed-first heuristic.
 */
export function decodeLog(
  topics: string[],
  data: string,
  topic0: string,
  dynamicSig?: string,
): DecodedLog | null {
  let abi = EVENT_ABI_MAP[topic0]

  if (!abi && dynamicSig) {
    const indexedCount = Math.max(0, topics.length - 1)
    const inputs = parseEventSig(dynamicSig, indexedCount)
    if (inputs) abi = { name: dynamicSig.split('(')[0], inputs }
  }

  if (!abi) return null

  // Pre-decode all non-indexed params from data
  const dataInputs = abi.inputs.filter((i) => !i.indexed)
  const dataValues: DecodedValue[] = []
  if (dataInputs.length > 0 && data && data !== '0x') {
    try {
      const dataBytes = hexToBytes(data)
      let off = 0
      for (const inp of dataInputs) {
        dataValues.push(decodeValue(dataBytes, inp.type, inp.components, off, 0))
        off += headSize(inp.type, inp.components)
      }
    } catch { /* leave dataValues empty on malformed data */ }
  }

  // Build params in original ABI declaration order
  const params: DecodedLog['params'] = []
  let topicIdx = 1
  let dataIdx  = 0
  for (const inp of abi.inputs) {
    if (inp.indexed) {
      const topic = topics[topicIdx++]
      const value = topic
        ? decodeIndexedTopic(topic, inp.type, inp.components)
        : { kind: 'unknown' as const, type: inp.type }
      params.push({ name: inp.name, type: inp.type, indexed: true, value })
    } else {
      const value = dataValues[dataIdx++] ?? { kind: 'unknown' as const, type: inp.type }
      params.push({ name: inp.name, type: inp.type, indexed: false, value })
    }
  }

  return { name: abi.name, params }
}
