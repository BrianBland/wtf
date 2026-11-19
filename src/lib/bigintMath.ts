function compareBigInt(a: bigint, b: bigint): number {
  if (a === b) return 0
  return a > b ? 1 : -1
}

export function compareBigIntDesc(a: bigint, b: bigint): number {
  return compareBigInt(b, a)
}
