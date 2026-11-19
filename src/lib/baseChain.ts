// Base (OP Stack) protocol details from Jovian through Denim.
import { Block, Transaction } from '../types'
import { DEPOSIT_TX_TYPE } from './txMetrics'

export const DEPOSITOR_ACCOUNT = '0xdeaddeaddeaddeaddeaddeaddeaddeaddead0001'
export const L1_BLOCK_ADDRESS  = '0x4200000000000000000000000000000000000015'
export const BASE_TIME_ADDRESS = '0x4200000000000000000000000000000000000030'
const SET_TIMESTAMP_MILLIS_PART_SELECTOR = '0x86bdf394'

/** Base predeploys and native precompiles, for address labels. */
export const BASE_SYSTEM_CONTRACTS: Record<string, string> = {
  [L1_BLOCK_ADDRESS]:                           'L1Block',
  [BASE_TIME_ADDRESS]:                          'BaseTime',
  '0x420000000000000000000000000000000000000f': 'GasPriceOracle',
  '0x4200000000000000000000000000000000000011': 'SequencerFeeVault',
  '0x4200000000000000000000000000000000000016': 'L2ToL1MessagePasser',
  '0x4200000000000000000000000000000000000019': 'BaseFeeVault',
  '0x420000000000000000000000000000000000001a': 'L1FeeVault',
  '0x420000000000000000000000000000000000001b': 'OperatorFeeVault',
  '0x0000f90827f1c53a10cb7a02335b175320002935': 'HistoryStorage',
  '0x000f3df6d732807ef1319fb7b8bb8522d0beac02': 'BeaconRoots',
  '0x8453000000000000000000000000000000000001': 'B20 Activation Registry',
  '0x8453000000000000000000000000000000000002': 'B20 Policy',
  '0x813000000000000000000000000000000000aa01': 'Nonce Manager',
  '0x813000000000000000000000000000000000aa02': 'Tx Context',
  [DEPOSITOR_ACCOUNT]:                          'System Depositor',
}

export const BASE_SYSTEM_SELECTORS: Record<string, string> = {
  '0x440a5e20': 'setL1BlockValuesEcotone',
  '0x098999be': 'setL1BlockValuesIsthmus',
  '0x3db6be2b': 'setL1BlockValuesJovian',
  [SET_TIMESTAMP_MILLIS_PART_SELECTOR]: 'setTimestampMillisPart',
}

/** Decoded millisecond part of a Denim BaseTime update calldata, or null. */
function baseTimeMillisPart(to: string | null, input: string): number | null {
  if (to?.toLowerCase() !== BASE_TIME_ADDRESS) return null
  if (input.length !== 2 + 72 || !input.toLowerCase().startsWith(SET_TIMESTAMP_MILLIS_PART_SELECTOR)) return null
  const millis = parseInt(input.slice(10), 16)
  return millis < 1000 ? millis : null
}

/** Since Denim, header timestamps are whole seconds shared by 5 blocks; tx[1] carries the millis. */
export function blockTimestampMs(timestamp: number, txs: Pick<Transaction, 'to' | 'input'>[]): number {
  const tx1 = txs[1]
  const millis = tx1 ? baseTimeMillisPart(tx1.to, tx1.input) : null
  return timestamp * 1000 + (millis ?? 0)
}

export function systemTxLabel(tx: Transaction): string | null {
  if (tx.type !== DEPOSIT_TX_TYPE) return null
  if (tx.from === DEPOSITOR_ACCOUNT && tx.to === L1_BLOCK_ADDRESS) return 'L1 info'
  if (tx.from === DEPOSITOR_ACCOUNT) {
    const millis = baseTimeMillisPart(tx.to, tx.input)
    if (millis !== null) return `BaseTime .${String(millis).padStart(3, '0')}`
    return 'system deposit'
  }
  return 'deposit'
}

export interface Eip1559Params {
  denominator: number
  elasticity: number
  minBaseFee?: bigint
}

/** Holocene (v0, 9 bytes) / Jovian (v1, 17 bytes) EIP-1559 parameters from header extraData. */
export function decodeEip1559Params(extraData: string | undefined): Eip1559Params | undefined {
  const hex = extraData?.toLowerCase().replace(/^0x/, '') ?? ''
  const version = hex.slice(0, 2)
  if (!((version === '00' && hex.length === 18) || (version === '01' && hex.length === 34))) return undefined
  const denominator = parseInt(hex.slice(2, 10), 16)
  const elasticity = parseInt(hex.slice(10, 18), 16)
  if (denominator === 0 || elasticity === 0) return undefined
  return version === '01'
    ? { denominator, elasticity, minBaseFee: BigInt(`0x${hex.slice(18)}`) }
    : { denominator, elasticity }
}

/** Since Jovian the base fee tracks max(gas used, DA footprint), carried in blobGasUsed. */
export function blockUtilization(block: Pick<Block, 'gasUsed' | 'gasLimit' | 'daFootprint'>): number {
  const used = block.daFootprint !== undefined && block.daFootprint > block.gasUsed ? block.daFootprint : block.gasUsed
  return Number(used) / Number(block.gasLimit || 1n)
}
