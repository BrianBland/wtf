/**
 * Types and helpers for per-tx state access tracing via debug_traceTransaction
 * with the built-in prestateTracer.
 */

// ── Raw RPC response shapes ───────────────────────────────────────────────────

export type PrestateAccount = {
  balance?: string
  nonce?: number
  code?: string
  storage?: Record<string, string>   // slot (0x + 64 hex) → value
}
export type PrestateResult    = Record<string, PrestateAccount>
export type PrestateDiffResult = { pre: PrestateResult; post: PrestateResult }

// ── Domain types ─────────────────────────────────────────────────────────────

/** A single access to a state key by one transaction. */
export interface StateAccess {
  /** "0xaddr" for account-level, "0xaddr::0xslot" for storage */
  key:    string
  addr:   string
  slot?:  string
  type:   'read' | 'write'
}

/** Progress state for one block's worth of tracing. */
export interface BlockStateProgress {
  status:    'running' | 'done' | 'error'
  done:      number
  total:     number
  /** txHash → accesses.  Missing = not yet traced (or failed silently). */
  txResults: Map<string, StateAccess[]>
  /** txHash → call tree (callTracer output).  Populated alongside txResults. */
  callResults: Map<string, import('../types').CallTrace>
  /** Set of tx hashes that errored (so we can skip them cleanly). */
  errors:    Set<string>
}

// ── Merge logic ───────────────────────────────────────────────────────────────

const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
// OP Stack fee vault predeployments — written by every tx, add noise to the viz.
const EXCLUDED_ADDRS = new Set([
  '0x4200000000000000000000000000000000000011', // SequencerFeeVault
  '0x4200000000000000000000000000000000000019', // L1FeeVault
  '0x420000000000000000000000000000000000001a', // BaseFeeVault
])

/**
 * Combine a non-diffMode prestate result (all touched state) with a
 * diffMode result (only modified state) to classify accesses as read or write.
 *
 * Rules:
 *  - Storage slot in post.addr.storage       → WRITE
 *  - Account in post with balance/nonce delta → account-level WRITE
 *  - Everything else touched in allAccesses   → READ
 */
export function mergePrestate(
  allAccesses: PrestateResult,
  diff: PrestateDiffResult,
): StateAccess[] {
  const result: StateAccess[] = []

  // Build write sets from diff.post
  const writtenAccounts = new Set<string>()
  const writtenSlots    = new Map<string, Set<string>>() // addr → set of slots

  for (const [rawAddr, postAcc] of Object.entries(diff.post ?? {})) {
    const addr = rawAddr.toLowerCase()
    // Account-level write: balance or nonce changed
    if (postAcc.balance !== undefined || postAcc.nonce !== undefined) {
      writtenAccounts.add(addr)
    }
    // Storage writes
    if (postAcc.storage) {
      if (!writtenSlots.has(addr)) writtenSlots.set(addr, new Set())
      for (const slot of Object.keys(postAcc.storage)) {
        writtenSlots.get(addr)!.add(slot.toLowerCase())
      }
    }
  }

  for (const [rawAddr, acc] of Object.entries(allAccesses ?? {})) {
    const addr = rawAddr.toLowerCase()
    if (addr === ZERO_ADDR) continue
    if (EXCLUDED_ADDRS.has(addr)) continue

    // Account-level access
    const acctKey  = addr
    const acctType: 'read' | 'write' = writtenAccounts.has(addr) ? 'write' : 'read'
    result.push({ key: acctKey, addr, type: acctType })

    // Storage accesses
    if (acc.storage) {
      const wSlots = writtenSlots.get(addr)
      for (const rawSlot of Object.keys(acc.storage)) {
        const slot    = rawSlot.toLowerCase()
        const slotKey = `${addr}::${slot}`
        const type: 'read' | 'write' = wSlots?.has(slot) ? 'write' : 'read'
        result.push({ key: slotKey, addr, slot, type })
      }
    }
  }

  return result
}

// ── Aggregation helpers ───────────────────────────────────────────────────────

/**
 * Aggregate per-tx results into a map: stateKey → { txHashes, hasWrite, hasRead }.
 * Used to decide which state keys are most contended and how to draw them.
 */
export interface KeyStats {
  key:      string
  addr:     string
  slot?:    string
  txCount:  number    // unique txs accessing this key
  writeCount: number  // txs that WRITE this key
  readCount:  number  // txs that ONLY READ this key
}

export function aggregateKeys(
  txResults: Map<string, StateAccess[]>,
  filterAccountLevel: boolean,
): KeyStats[] {
  const byKey = new Map<string, { addr: string; slot?: string; txHashes: Set<string>; writes: Set<string> }>()

  for (const [txHash, accesses] of txResults) {
    for (const acc of accesses) {
      if (filterAccountLevel && !acc.slot) continue
      let entry = byKey.get(acc.key)
      if (!entry) {
        entry = { addr: acc.addr, slot: acc.slot, txHashes: new Set(), writes: new Set() }
        byKey.set(acc.key, entry)
      }
      entry.txHashes.add(txHash)
      if (acc.type === 'write') entry.writes.add(txHash)
    }
  }

  return [...byKey.entries()].map(([key, { addr, slot, txHashes, writes }]) => ({
    key, addr, slot,
    txCount:    txHashes.size,
    writeCount: writes.size,
    readCount:  txHashes.size - writes.size,
  }))
}

// ── Parallelization analysis ──────────────────────────────────────────────────

/**
 * Parallelization statistics for a block's transactions.
 *
 * Based on RAW (Read-After-Write) and WAW (Write-After-Write) dependencies.
 * WAR (Write-After-Read) is NOT a dependency for parallel execution.
 *
 * - criticalPath:    The minimum number of sequential batches required
 *                    (i.e. the longest dependency chain length).
 * - maxConcurrent:   The widest batch — how many txs can run in parallel at peak.
 * - conflictedTxs:   Number of txs that depend on at least one prior tx.
 * - score:           Parallelizability in [0, 1].
 *                    1 = fully parallel (all txs independent),
 *                    0 = fully sequential (each tx depends on the previous).
 */
export interface ParallelizationStats {
  totalTxs:      number
  criticalPath:  number   // min sequential batches (longest chain)
  maxConcurrent: number   // max txs in a single batch
  conflictedTxs: number   // txs with ≥1 RAW or WAW dependency
  score:         number   // 1 - (criticalPath - 1) / max(n - 1, 1)
}

/**
 * Compute parallelization stats from per-tx state access results.
 *
 * orderedTxHashes must be in canonical block order (index 0 = first tx).
 * txs not present in txResults are treated as having no accesses.
 *
 * Algorithm: O(n × k) forward scan.
 *   keyWriterDepth[key] = max batch-depth among all txs that WROTE key so far.
 *   For each tx i (in order):
 *     depth[i] = 1 + max(keyWriterDepth[key]) for all keys tx i accesses.
 *     After computing depth[i], update keyWriterDepth for keys tx i WRITES.
 */
export function computeParallelization(
  txResults: Map<string, StateAccess[]>,
  orderedTxHashes: string[],
): ParallelizationStats {
  const n = orderedTxHashes.length
  if (n === 0) return { totalTxs: 0, criticalPath: 0, maxConcurrent: 0, conflictedTxs: 0, score: 1 }

  // keyWriterDepth: for each state key, the max depth of any tx that wrote it
  const keyWriterDepth = new Map<string, number>()
  const depths: number[] = new Array(n)
  let conflictedTxs = 0

  for (let i = 0; i < n; i++) {
    const accesses = txResults.get(orderedTxHashes[i]) ?? []
    let d = 1
    for (const acc of accesses) {
      const wd = keyWriterDepth.get(acc.key)
      if (wd !== undefined && wd + 1 > d) d = wd + 1
    }
    depths[i] = d
    if (d > 1) conflictedTxs++

    // Update writer depths — only for writes (WAR is not a dependency)
    for (const acc of accesses) {
      if (acc.type !== 'write') continue
      const cur = keyWriterDepth.get(acc.key) ?? 0
      if (d > cur) keyWriterDepth.set(acc.key, d)
    }
  }

  const criticalPath = Math.max(...depths)

  // Count txs at each depth level to find the widest batch
  const depthCounts = new Array<number>(criticalPath + 1).fill(0)
  for (const d of depths) depthCounts[d]++
  const maxConcurrent = Math.max(...depthCounts.slice(1))

  const score = n <= 1 ? 1 : 1 - (criticalPath - 1) / (n - 1)

  return { totalTxs: n, criticalPath, maxConcurrent, conflictedTxs, score }
}
