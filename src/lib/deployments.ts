import { Deployment, Log, RawReceipt, RawTransaction } from '../types'
import { classifyB20Address } from './b20'

export const B20_FACTORY_ADDRESS = '0xb20f000000000000000000000000000000000000'
export const B20_CREATED_TOPIC = '0xfd9bf2730513a1709722ff379a0844dfd8f997d600693c2bcc659e188bbdba0d'

const ADDRESS_RE = /^0x[0-9a-f]{40}$/i
const HASH_RE = /^0x[0-9a-f]{64}$/i
const WORD_RE = /^[0-9a-f]{64}$/i
const DATA_RE = /^0x(?:[0-9a-f]{2})*$/i

function normalizeAddress(value: unknown): string | null {
  return typeof value === 'string' && ADDRESS_RE.test(value) ? value.toLowerCase() : null
}

function normalizedHash(value: unknown): string | null {
  return typeof value === 'string' && HASH_RE.test(value) ? value.toLowerCase() : null
}

function decodeAddressTopic(topic: unknown): string | null {
  if (typeof topic !== 'string' || !/^0x[0-9a-f]{64}$/i.test(topic)) return null
  const word = topic.slice(2)
  if (!/^0{24}$/i.test(word.slice(0, 24))) return null
  return normalizeAddress(`0x${word.slice(24)}`)
}

function decodeUint8Topic(topic: unknown): number | null {
  if (typeof topic !== 'string' || !/^0x[0-9a-f]{64}$/i.test(topic)) return null
  const word = topic.slice(2)
  if (!/^0{62}$/i.test(word.slice(0, 62))) return null
  const value = Number.parseInt(word.slice(62), 16)
  return value === 0 || value === 1 ? value : null
}

function bytesFromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

interface DynamicValue {
  bytes: Uint8Array
  end: number
}

/** Decode a dynamic ABI value at the canonical next offset. */
function decodeDynamic(body: string, totalBytes: number, offset: number): DynamicValue | null {
  if (offset % 32 !== 0 || offset < 0 || offset + 32 > totalBytes) return null
  const lengthWord = body.slice(offset * 2, (offset + 32) * 2)
  if (!WORD_RE.test(lengthWord)) return null

  let lengthBig: bigint
  try {
    lengthBig = BigInt(`0x${lengthWord}`)
  } catch {
    return null
  }
  const available = BigInt(totalBytes - offset - 32)
  if (lengthBig > available) return null

  // Conversion is safe only after bounding the value by the in-memory payload length.
  const length = Number(lengthBig)
  const paddedLength = Math.ceil(length / 32) * 32
  const end = offset + 32 + paddedLength
  if (end > totalBytes) return null

  const contentStart = (offset + 32) * 2
  const contentEnd = contentStart + length * 2
  const paddedEnd = end * 2
  if (!/^0*$/i.test(body.slice(contentEnd, paddedEnd))) return null

  return { bytes: bytesFromHex(body.slice(contentStart, contentEnd)), end }
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

interface B20EventData {
  name: string
  symbol: string
  decimals: number
  variantParams: Uint8Array
}

/**
 * Strictly decode B20Created's non-indexed (string,string,uint8,bytes) tuple.
 * Dynamic tails must use the unique canonical ABI layout: ordered, contiguous,
 * word-aligned, zero-padded, and with no unconsumed trailing bytes.
 */
function decodeB20EventData(data: unknown): B20EventData | null {
  if (typeof data !== 'string' || !DATA_RE.test(data)) return null
  const body = data.slice(2)
  const totalBytes = body.length / 2
  if (totalBytes < 128 || totalBytes % 32 !== 0) return null

  const words = [0, 1, 2, 3].map((index) => body.slice(index * 64, (index + 1) * 64))
  if (words.some((word) => !WORD_RE.test(word))) return null

  let nameOffset: bigint
  let symbolOffset: bigint
  let decimalsBig: bigint
  let paramsOffset: bigint
  try {
    nameOffset = BigInt(`0x${words[0]}`)
    symbolOffset = BigInt(`0x${words[1]}`)
    decimalsBig = BigInt(`0x${words[2]}`)
    paramsOffset = BigInt(`0x${words[3]}`)
  } catch {
    return null
  }
  if (decimalsBig > 255n) return null

  // The first tail starts immediately after the four-word head. Requiring each
  // subsequent offset to equal the prior tail's end rejects aliases and gaps.
  if (nameOffset !== 128n) return null
  const nameValue = decodeDynamic(body, totalBytes, 128)
  if (!nameValue || symbolOffset !== BigInt(nameValue.end)) return null
  const symbolValue = decodeDynamic(body, totalBytes, nameValue.end)
  if (!symbolValue || paramsOffset !== BigInt(symbolValue.end)) return null
  const paramsValue = decodeDynamic(body, totalBytes, symbolValue.end)
  if (!paramsValue || paramsValue.end !== totalBytes) return null

  const name = decodeUtf8(nameValue.bytes)
  const symbol = decodeUtf8(symbolValue.bytes)
  if (name === null || symbol === null) return null

  return { name, symbol, decimals: Number(decimalsBig), variantParams: paramsValue.bytes }
}

function hexFromBytes(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/** Validate Alloy/Solidity single-value ABI encoding of (uint8 version,string currency). */
function isCanonicalStablecoinEventParams(bytes: Uint8Array): boolean {
  const body = hexFromBytes(bytes)
  const totalBytes = bytes.length
  if (totalBytes < 160 || totalBytes % 32 !== 0) return false

  const outerOffset = body.slice(0, 64)
  const version = body.slice(64, 128)
  const currencyOffset = body.slice(128, 192)
  if (outerOffset !== wordHex(32n)) return false
  if (version !== wordHex(1n)) return false
  // Offset is relative to the tuple beginning immediately after the outer head.
  if (currencyOffset !== wordHex(64n)) return false

  const currencyValue = decodeDynamic(body, totalBytes, 96)
  if (!currencyValue || currencyValue.end !== totalBytes) return false
  const currency = decodeUtf8(currencyValue.bytes)
  // Factory storage initialization requires a non-empty sequence of ASCII A-Z.
  return currency !== null && /^[A-Z]+$/.test(currency)
}

function wordHex(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

export function detectB20Deployments(logs: unknown): Extract<Deployment, { kind: 'b20' }>[] {
  const deployments = new Map<string, Extract<Deployment, { kind: 'b20' }>>()
  if (!Array.isArray(logs)) return []

  for (const candidate of logs) {
    if (candidate === null || typeof candidate !== 'object') continue
    const log = candidate as Partial<Log>
    if (normalizeAddress(log.address) !== B20_FACTORY_ADDRESS) continue
    if (!Array.isArray(log.topics) || log.topics.length !== 3) continue
    if (typeof log.topics[0] !== 'string' || log.topics[0].toLowerCase() !== B20_CREATED_TOPIC) continue

    const address = decodeAddressTopic(log.topics[1])
    const variantValue = decodeUint8Topic(log.topics[2])
    if (!address || variantValue === null) continue

    const variant = classifyB20Address(address)
    const expectedVariant = variantValue === 0 ? 'asset' : 'stablecoin'
    if (variant !== expectedVariant) continue

    const decoded = decodeB20EventData(log.data)
    if (!decoded) continue
    // Canonical Base constraints: Assets allow 6..18 decimals and emit empty
    // variantParams. Stablecoins use 6 decimals and emit versioned currency data.
    if (variant === 'asset') {
      if (decoded.decimals < 6 || decoded.decimals > 18 || decoded.variantParams.length !== 0) continue
    } else {
      if (decoded.decimals !== 6 || !isCanonicalStablecoinEventParams(decoded.variantParams)) continue
    }

    if (!deployments.has(address)) {
      deployments.set(address, {
        kind: 'b20',
        address,
        source: 'b20-factory',
        variant,
        name: decoded.name,
        symbol: decoded.symbol,
        decimals: decoded.decimals,
      })
    }
  }

  return [...deployments.values()]
}

function receiptMatchesTransaction(receipt: RawReceipt | undefined, rawTx: RawTransaction): boolean {
  const receiptHash = normalizedHash(receipt?.transactionHash)
  const txHash = normalizedHash(rawTx.hash)
  return receiptHash !== null && txHash !== null && receiptHash === txHash
}

/** Detect only the approved receipt-backed top-level CREATE and canonical B20 event paths. */
export function detectDeployments(
  logs: unknown,
  rawTx: RawTransaction,
  receipt?: RawReceipt,
): Deployment[] {
  if (!Array.isArray(logs)) return []
  const matches = receiptMatchesTransaction(receipt, rawTx)
  if (matches && receipt?.status === '0x0') return []

  const byAddress = new Map<string, Deployment>()
  if (matches && receipt?.status === '0x1' && rawTx.to === null) {
    const address = normalizeAddress(receipt.contractAddress)
    if (address) byAddress.set(address, { kind: 'contract', address, source: 'receipt' })
  }

  // Canonical logs remain deployment proof when receipts are absent or malformed.
  // In the synthetic address collision case, the more specific B20 proof wins.
  for (const deployment of detectB20Deployments(logs)) byAddress.set(deployment.address, deployment)
  return [...byAddress.values()]
}
