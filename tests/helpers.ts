// Shared synthetic-log builders for tests. No network access, no Foundry — pure ABI encoding.
import { Log } from '../src/types'

/** Left-pad a hex string (no 0x prefix) to a 32-byte (64 hex char) ABI word. */
export function wordUint(value: bigint): string {
  if (value < 0n) throw new Error('use wordInt for signed values')
  return value.toString(16).padStart(64, '0')
}

export function wordAddress(address: string): string {
  const hex = address.toLowerCase().replace(/^0x/, '')
  return hex.padStart(64, '0')
}

/** Build the `data` field of a log from an ordered list of 32-byte words. */
export function encodeData(words: string[]): string {
  return '0x' + words.join('')
}

function bytesHex(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function dynamicBytes(hex: string): string {
  const byteLength = hex.length / 2
  return wordUint(BigInt(byteLength)) + hex.padEnd(Math.ceil(byteLength / 32) * 64, '0')
}

/** Canonical single-value ABI encoding for B20StablecoinEventParams. */
export function encodeB20StablecoinEventParams(currency: string, version = 1): string {
  return encodeData([
    wordUint(32n),
    wordUint(BigInt(version)),
    wordUint(64n),
    dynamicBytes(bytesHex(currency)),
  ])
}

/** Canonical ABI encoding for B20Created's (string,string,uint8,bytes) data. */
export function encodeB20CreatedData(
  name: string,
  symbol: string,
  decimals: number,
  variantParams = '0x',
): string {
  const nameTail = dynamicBytes(bytesHex(name))
  const symbolTail = dynamicBytes(bytesHex(symbol))
  const paramsHex = variantParams.replace(/^0x/, '')
  const paramsTail = dynamicBytes(paramsHex)
  const nameOffset = 128
  const symbolOffset = nameOffset + nameTail.length / 2
  const paramsOffset = symbolOffset + symbolTail.length / 2
  return encodeData([
    wordUint(BigInt(nameOffset)),
    wordUint(BigInt(symbolOffset)),
    wordUint(BigInt(decimals)),
    wordUint(BigInt(paramsOffset)),
    nameTail,
    symbolTail,
    paramsTail,
  ])
}

let logIndexCounter = 0

export function makeLog(partial: Partial<Log> & Pick<Log, 'address' | 'topics' | 'data'>): Log {
  logIndexCounter += 1
  return {
    transactionHash: '0xtest',
    logIndex: logIndexCounter,
    ...partial,
  }
}

export function resetLogIndexCounter(): void {
  logIndexCounter = 0
}
