export function compareBigInt(a: bigint, b: bigint): number {
  if (a === b) return 0
  return a > b ? 1 : -1
}

export function compareBigIntDesc(a: bigint, b: bigint): number {
  return compareBigInt(b, a)
}

export function compareBigIntAbsDesc(a: bigint, b: bigint): number {
  const absA = a < 0n ? -a : a
  const absB = b < 0n ? -b : b
  return compareBigIntDesc(absA, absB)
}
