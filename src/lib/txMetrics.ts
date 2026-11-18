import { Transaction } from '../types'

export const DEPOSIT_TX_TYPE = 0x7e

export function txGasUsed(tx: Transaction): bigint {
  return tx.gasUsed ?? tx.gas
}

/** Tip actually paid per gas: the receipt's effective gas price minus the base fee. */
export function effectivePriorityFee(tx: Transaction, baseFee: bigint): bigint {
  const tip = effectiveGasPrice(tx, baseFee) - baseFee
  return tip > 0n ? tip : 0n
}

export function effectiveGasPrice(tx: Transaction, baseFee: bigint): bigint {
  if (tx.effectiveGasPrice !== undefined) return tx.effectiveGasPrice
  if (tx.maxPriorityFeePerGas !== undefined) {
    const priceCap = tx.maxFeePerGas ?? baseFee + tx.maxPriorityFeePerGas
    const withTip = baseFee + tx.maxPriorityFeePerGas
    return withTip < priceCap ? withTip : priceCap
  }
  if (tx.gasPrice !== undefined) return tx.gasPrice
  return baseFee
}

export function totalTxFee(tx: Transaction, baseFee: bigint): bigint {
  return txGasUsed(tx) * effectiveGasPrice(tx, baseFee) + (tx.l1Fee ?? 0n)
}

export interface TipRise {
  previousHash: string
  sameSender: boolean
}

/**
 * Sequencer txs whose tip exceeds the preceding sequencer tx's tip. Priority-ordered
 * blocks only rise like this for backruns or a sender's queued txs with ascending tips.
 * Deposits (including the tx[0]/tx[1] system deposits) are skipped on both sides.
 */
export function findTipRises(txs: Transaction[], baseFee: bigint): Map<string, TipRise> {
  const rises = new Map<string, TipRise>()
  let previous: { tx: Transaction; tip: bigint } | null = null
  for (const tx of txs) {
    if (tx.index < 2 || tx.type === DEPOSIT_TX_TYPE) continue
    const tip = effectivePriorityFee(tx, baseFee)
    if (previous && tip > previous.tip) {
      rises.set(tx.hash, { previousHash: previous.tx.hash, sameSender: previous.tx.from === tx.from })
    }
    previous = { tx, tip }
  }
  return rises
}
