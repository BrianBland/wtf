import { Transaction } from '../types'

export function txGasUsed(tx: Transaction): bigint {
  return tx.gasUsed ?? tx.gas
}

export function effectivePriorityFee(tx: Transaction, baseFee: bigint): bigint {
  if (tx.maxPriorityFeePerGas !== undefined) return tx.maxPriorityFeePerGas
  if (tx.gasPrice !== undefined) return tx.gasPrice > baseFee ? tx.gasPrice - baseFee : 0n
  return 0n
}

export function effectiveGasPrice(tx: Transaction, baseFee: bigint): bigint {
  if (tx.maxPriorityFeePerGas !== undefined) return baseFee + tx.maxPriorityFeePerGas
  if (tx.gasPrice !== undefined) return tx.gasPrice
  return baseFee
}

export function totalTxFee(tx: Transaction, baseFee: bigint): bigint {
  return txGasUsed(tx) * effectiveGasPrice(tx, baseFee)
}
