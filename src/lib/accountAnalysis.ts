import { Block } from '../types'

export interface NetFlow {
  token: string    // contract address or 'ETH'
  sent: bigint
  received: bigint
  net: bigint      // received - sent (positive = net receiver)
}

export type PatternTag =
  | 'round-trip'      // bought and sold same token, net < 5% of gross
  | 'borrow-repay'    // Borrow + Repay same token in block
  | 'supply-withdraw' // Supply + Withdraw same token in block
  | 'add-remove-lp'   // AddLiquidity + RemoveLiquidity in block
  | 'multi-swap'      // 3+ swaps in block

export interface AccountActivity {
  address: string
  txCount: number
  txHashes: string[]
  patterns: PatternTag[]
  netFlows: NetFlow[]
}

export function analyzeBlockAccounts(block: Block): AccountActivity[] {
  // address → set of tx hashes it appeared in
  const addrTxs = new Map<string, Set<string>>()
  // address → aggregated action counts for pattern detection
  const addrSwaps     = new Map<string, number>()
  const addrBorrows   = new Map<string, Set<string>>()  // token addresses
  const addrRepays    = new Map<string, Set<string>>()
  const addrSupplies  = new Map<string, Set<string>>()
  const addrWithdraws = new Map<string, Set<string>>()
  const addrAddLp     = new Map<string, number>()
  const addrRemoveLp  = new Map<string, number>()
  // address → token → { sent, received }
  const addrFlows = new Map<string, Map<string, { sent: bigint; received: bigint }>>()

  const touch = (addr: string, txHash: string) => {
    if (!addrTxs.has(addr)) addrTxs.set(addr, new Set())
    addrTxs.get(addr)!.add(txHash)
  }

  const addFlow = (addr: string, token: string, sent: bigint, received: bigint) => {
    if (!addrFlows.has(addr)) addrFlows.set(addr, new Map())
    const m = addrFlows.get(addr)!
    const cur = m.get(token) ?? { sent: 0n, received: 0n }
    m.set(token, { sent: cur.sent + sent, received: cur.received + received })
  }

  const incSet = (map: Map<string, Set<string>>, addr: string, val: string) => {
    if (!map.has(addr)) map.set(addr, new Set())
    map.get(addr)!.add(val)
  }

  const inc = (map: Map<string, number>, addr: string, by = 1) =>
    map.set(addr, (map.get(addr) ?? 0) + by)

  for (const tx of block.transactions) {
    const { hash, from, to, value, tokenFlows, ethFlows, protocols } = tx

    touch(from, hash)
    if (to) touch(to, hash)

    // ETH flows
    if (value > 0n) {
      addFlow(from, 'ETH', value, 0n)
      if (to) addFlow(to, 'ETH', 0n, value)
    }
    for (const ef of ethFlows) {
      if (ef.type === 'internal') {
        addFlow(ef.from, 'ETH', ef.value, 0n)
        addFlow(ef.to, 'ETH', 0n, ef.value)
      }
    }

    // Token flows
    for (const tf of tokenFlows) {
      touch(tf.from, hash)
      touch(tf.to, hash)
      addFlow(tf.from, tf.token, tf.amount, 0n)
      addFlow(tf.to, tf.token, 0n, tf.amount)
    }

    // Protocol events — attribute to tx.from (the initiator)
    for (const ev of protocols) {
      const addr = from
      switch (ev.action) {
        case 'Swap':            inc(addrSwaps, addr); break
        case 'Borrow':          if (ev.token) incSet(addrBorrows, addr, ev.token); break
        case 'Repay':           if (ev.token) incSet(addrRepays, addr, ev.token); break
        case 'Supply':          if (ev.token) incSet(addrSupplies, addr, ev.token); break
        case 'Withdraw':        if (ev.token) incSet(addrWithdraws, addr, ev.token); break
        case 'AddLiquidity':    inc(addrAddLp, addr); break
        case 'RemoveLiquidity': inc(addrRemoveLp, addr); break
      }
    }
  }

  const results: AccountActivity[] = []

  for (const [addr, txSet] of addrTxs) {
    if (txSet.size < 2) continue

    const flowMap = addrFlows.get(addr) ?? new Map<string, { sent: bigint; received: bigint }>()
    const netFlows: NetFlow[] = []

    for (const [token, { sent, received }] of flowMap) {
      if (sent === 0n && received === 0n) continue
      netFlows.push({ token, sent, received, net: received - sent })
    }

    const patterns: PatternTag[] = []

    // Round-trip: bought and sold same token, net < 5% of gross
    for (const { sent, received } of netFlows) {
      if (sent > 0n && received > 0n) {
        const gross = sent + received
        const diff  = sent > received ? sent - received : received - sent
        if (diff * 20n < gross) {
          patterns.push('round-trip')
          break
        }
      }
    }

    // Borrow + Repay same token
    const borrows   = addrBorrows.get(addr)
    const repays    = addrRepays.get(addr)
    if (borrows && repays && [...borrows].some((t) => repays.has(t))) {
      patterns.push('borrow-repay')
    }

    // Supply + Withdraw same token
    const supplies  = addrSupplies.get(addr)
    const withdraws = addrWithdraws.get(addr)
    if (supplies && withdraws && [...supplies].some((t) => withdraws.has(t))) {
      patterns.push('supply-withdraw')
    }

    // Add + Remove LP
    const addLp    = addrAddLp.get(addr) ?? 0
    const removeLp = addrRemoveLp.get(addr) ?? 0
    if (addLp > 0 && removeLp > 0) patterns.push('add-remove-lp')

    // Multi-swap
    if ((addrSwaps.get(addr) ?? 0) >= 3) patterns.push('multi-swap')

    // Only include if there are interesting patterns OR 3+ txs
    if (patterns.length > 0 || txSet.size >= 3) {
      results.push({
        address:  addr,
        txCount:  txSet.size,
        txHashes: [...txSet],
        patterns,
        netFlows: netFlows.sort((a, b) => {
          // Sort by absolute net flow magnitude descending
          const aMag = a.net < 0n ? -a.net : a.net
          const bMag = b.net < 0n ? -b.net : b.net
          return bMag > aMag ? 1 : bMag < aMag ? -1 : 0
        }),
      })
    }
  }

  return results.sort((a, b) => b.patterns.length - a.patterns.length || b.txCount - a.txCount)
}
