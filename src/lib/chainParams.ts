import { Block } from '../types'

/**
 * Estimate the EIP-1559 elasticity multiplier from observed block data.
 *
 * Uses the base fee update formula from the OP Stack / EIP-1559 spec:
 *
 *   nextBaseFee = baseFee + baseFee × (gasUsed − gasTarget) / (gasTarget × denominator)
 *
 * Rearranging to solve for gasTarget:
 *
 *   gasTarget = (baseFee × gasUsed) / (baseFee + denominator × Δbasefee)
 *
 * We try the three known EIP-1559 denominators:
 *   − 8   (Ethereum mainnet)
 *   − 50  (OP Stack pre-Canyon)
 *   − 250 (OP Stack Canyon+, i.e. Base mainnet)
 *
 * and pick the one that produces the most consistent (lowest coefficient of
 * variation) gasTarget estimates across consecutive block pairs.  From the
 * best-fitting denominator we derive:
 *
 *   elasticity = round(gasLimit / gasTarget)
 *
 * Falls back to average utilisation if no fee changes are usable.
 */
export function estimateElasticity(blocks: Block[]): number {
  const sorted = [...blocks].sort((a, b) => a.number - b.number)

  // Collect consecutive pairs with EIP-1559 base fees and a non-trivial fee delta.
  // Pairs with near-zero delta are noisy (target ≈ gasUsed regardless of denom).
  type Pair = { gasUsed: number; gasLimit: number; baseFee: number; delta: number }
  const pairs: Pair[] = []

  for (let i = 0; i + 1 < sorted.length; i++) {
    const curr = sorted[i]
    const next = sorted[i + 1]
    if (next.number !== curr.number + 1) continue  // gap in block sequence
    if (curr.baseFeePerGas <= 0n || next.baseFeePerGas <= 0n) continue  // pre-EIP-1559
    const baseFee = Number(curr.baseFeePerGas)
    const delta   = Number(next.baseFeePerGas) - baseFee
    // Skip pairs where the fee moved less than 10M wei (≈ 0.01 gwei) — too noisy
    if (Math.abs(delta) < 10_000_000) continue
    pairs.push({ gasUsed: Number(curr.gasUsed), gasLimit: Number(curr.gasLimit), baseFee, delta })
  }

  if (pairs.length >= 2) {
    // Try each known denominator, pick the one with lowest coefficient of variation
    // across all per-pair gasTarget estimates.
    const DENOMINATORS = [8, 50, 250]
    let bestDenom = 250
    let bestCV    = Infinity

    for (const denom of DENOMINATORS) {
      const targets = pairs
        .map(({ gasUsed, baseFee, delta }) => {
          const t = (baseFee * gasUsed) / (baseFee + denom * delta)
          return t > 0 && isFinite(t) ? t : null
        })
        .filter((t): t is number => t !== null)

      if (targets.length < 2) continue
      const mean     = targets.reduce((s, t) => s + t, 0) / targets.length
      const variance = targets.reduce((s, t) => s + (t - mean) ** 2, 0) / targets.length
      const cv       = Math.sqrt(variance) / mean  // normalised spread

      if (cv < bestCV) { bestCV = cv; bestDenom = denom }
    }

    const targets = pairs
      .map(({ gasUsed, baseFee, delta }) => {
        const t = (baseFee * gasUsed) / (bestDenom * delta + baseFee)
        return t > 0 && isFinite(t) ? t : null
      })
      .filter((t): t is number => t !== null)

    if (targets.length > 0) {
      const avgTarget   = targets.reduce((s, t) => s + t, 0) / targets.length
      const avgGasLimit = pairs.reduce((s, p) => s + p.gasLimit, 0) / pairs.length
      const elasticity  = Math.round(avgGasLimit / avgTarget)
      return Math.max(1, Math.min(16, elasticity))
    }
  }

  // Fallback: near equilibrium gasUsed ≈ gasTarget, so elasticity ≈ gasLimit / mean(gasUsed)
  const eip1559 = sorted.filter(b => b.baseFeePerGas > 0n)
  if (eip1559.length > 0) {
    const avgUtil = eip1559.reduce(
      (s, b) => s + Number(b.gasUsed) / Number(b.gasLimit), 0
    ) / eip1559.length
    return Math.max(1, Math.min(16, Math.round(1 / Math.max(avgUtil, 0.05))))
  }

  return 2  // pre-EIP-1559 chain or insufficient data
}
