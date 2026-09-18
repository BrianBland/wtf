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
