import { Block } from '../types'
import { HistEntry } from '../components/Histogram'

export type AggMetric = 'txs' | 'gas'

export interface BlockHistograms {
  senders:    HistEntry[]
  recipients: HistEntry[]
  selectors:  HistEntry[]
  protocols:  HistEntry[]
}

/** Aggregate histogram data across one or more blocks.
 *  Always computes both tx count and Kgas (gasUsed / 1000, falls back to gasLimit) per entry.
 *  Protocols deduplicate per-tx to avoid counting gas N times for N events in one tx.
 */
export function buildHistograms(blocks: Block[]): BlockHistograms {
  type Acc = { count: number; gas: number }
  const senders    = new Map<string, Acc>()
  const recipients = new Map<string, Acc>()
  const selectors  = new Map<string, Acc>()
  const protocols  = new Map<string, Acc>()

  const add = (m: Map<string, Acc>, key: string, kgas: number) => {
    const e = m.get(key) ?? { count: 0, gas: 0 }
    m.set(key, { count: e.count + 1, gas: e.gas + kgas })
  }

  for (const block of blocks) {
    for (const tx of block.transactions) {
      const kgas = Number(tx.gasUsed ?? tx.gas) / 1000
      add(senders, tx.from, kgas)
      if (tx.to) add(recipients, tx.to, kgas)
      if (tx.methodSelector) add(selectors, tx.methodSelector, kgas)
      // Deduplicate protocols per tx — avoids counting gas N times for N events in one tx
      const txProtocols = new Set(tx.protocols.map((ev) => ev.protocol))
      for (const proto of txProtocols) add(protocols, proto, kgas)
    }
  }

  const toEntries = (m: Map<string, Acc>): HistEntry[] =>
    [...m.entries()]
      .map(([key, { count, gas }]) => ({ key, count, gas }))
      .sort((a, b) => b.count - a.count)

  return {
    senders:    toEntries(senders),
    recipients: toEntries(recipients),
    selectors:  toEntries(selectors),
    protocols:  toEntries(protocols),
  }
}
