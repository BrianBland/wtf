import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { Block, Transaction } from '../types'
import { useStore } from '../store'
import { aggregateKeys, computeParallelization, KeyStats, StateAccess } from '../lib/stateAccess'
import { bandPath, addrLabel } from '../lib/sankeyLayout'
import { keyToHsl } from '../lib/colorize'
import { shortAddr, formatGas } from '../lib/formatters'
import { KNOWN_PROTOCOLS } from '../lib/protocols'
import { detectFlashblocks, flashblockCount, effectivePriorityFee } from '../lib/flashblocks'

// ── Colors ─────────────────────────────────────────────────────────────────────

const COLOR_READ  = '#4a9eff'
const COLOR_WRITE = '#ff5252'

// ── SVG constants ──────────────────────────────────────────────────────────────

const TX_LBL_W = 72
const SK_LBL_W = 170
const BAR_W    = 6
const TX_GAP   = 1
const SK_GAP   = 3
const PAD_Y    = 20
const MIN_TX_H = 2
const SK_H     = 8

// Column x positions — normal 2-column mode
const W_NORMAL = 960
const COL_TX   = TX_LBL_W               // 72
const COL_SK_N = W_NORMAL - SK_LBL_W - BAR_W  // 784

// Column x positions — split 3-column mode
const W_SPLIT  = 1100
const COL_ADDR = 380
const COL_SK_S = 780

// ── Types ──────────────────────────────────────────────────────────────────────

type Metric    = 'gas' | 'fee' | 'priority' | 'equal'
type SortOrder = 'index' | 'gas-desc' | 'priority-desc'

interface TxLayout   { tx: Transaction; y0: number; y1: number; h: number }
interface SkLayout   { ks: KeyStats;    y0: number; y1: number }
interface AddrLayout { addr: string; y0: number; y1: number; h: number; txCount: number; writeCount: number }

// Normal mode: TX → StateKey
interface Edge {
  txHash: string; key: string; type: 'read' | 'write'
  ty0: number; ty1: number; sy0: number; sy1: number
}

// Split mode: TX → Addr
interface TxAddrEdge {
  txHash: string; addr: string; type: 'read' | 'write'
  ty0: number; ty1: number; ay0: number; ay1: number
}

// Split mode: Addr → Slot
interface AddrSlotEdge {
  addr: string; slotKey: string; type: 'read' | 'write'
  ay0: number; ay1: number; sy0: number; sy1: number
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

function txWeight(tx: Transaction, metric: Metric, baseFee: bigint): number {
  if (metric === 'equal') return 1
  if (metric === 'gas')   return Number(tx.gasUsed ?? tx.gas)
  if (metric === 'fee') {
    const gasUsed = Number(tx.gasUsed ?? tx.gas)
    // For EIP-1559: (baseFee + tip) * gasUsed; for legacy: gasPrice * gasUsed
    const effectiveGasPrice = tx.maxPriorityFeePerGas !== undefined
      ? Number(baseFee) + Number(tx.maxPriorityFeePerGas)
      : tx.gasPrice !== undefined
        ? Number(tx.gasPrice)
        : Number(baseFee)
    return gasUsed * effectiveGasPrice
  }
  // 'priority': effective priority fee per gas
  return Number(effectivePriorityFee(tx, baseFee))
}

function metricLabel(metric: Metric, tx: Transaction, baseFee: bigint): string {
  if (metric === 'gas') return formatGas(tx.gasUsed ?? tx.gas)
  if (metric === 'fee') {
    const gasUsed = Number(tx.gasUsed ?? tx.gas)
    const effectiveGasPrice = tx.maxPriorityFeePerGas !== undefined
      ? Number(baseFee) + Number(tx.maxPriorityFeePerGas)
      : tx.gasPrice !== undefined
        ? Number(tx.gasPrice)
        : Number(baseFee)
    const totalFeeWei = gasUsed * effectiveGasPrice
    const gwei = totalFeeWei / 1e9
    return gwei >= 1e6 ? `${(gwei / 1e6).toFixed(2)} mGWEI` : `${gwei.toFixed(0)} gwei fee`
  }
  if (metric === 'priority') {
    const tip = effectivePriorityFee(tx, baseFee)
    if (tip > 0n) return `${(Number(tip) / 1e9).toFixed(2)} gwei/gas`
  }
  return `#${tx.index}`
}

function keyLabel(ks: KeyStats, cachedLabel: (addr: string) => string): { top: string; sub: string } {
  if (ks.slot) return { top: cachedLabel(ks.addr), sub: '…' + ks.slot.slice(-8) }
  return { top: cachedLabel(ks.addr), sub: '' }
}

// ── Layout ─────────────────────────────────────────────────────────────────────

function buildLayout(
  txs: Transaction[], stateKeys: KeyStats[], metric: Metric, baseFee: bigint,
): { txLayouts: TxLayout[]; skLayouts: SkLayout[]; H: number } {
  const weights    = txs.map((tx) => txWeight(tx, metric, baseFee))
  const totalW     = weights.reduce((s, w) => s + w, 0) || 1
  const TOTAL_H_TX = Math.max(txs.length * (MIN_TX_H + TX_GAP), stateKeys.length * (SK_H + SK_GAP))

  let y = PAD_Y
  const txLayouts: TxLayout[] = txs.map((tx, i) => {
    const h  = Math.max(MIN_TX_H, Math.round(weights[i] / totalW * TOTAL_H_TX))
    const tl = { tx, y0: y, y1: y + h, h }
    y += h + TX_GAP
    return tl
  })
  const totalTxH = y - TX_GAP

  const availH = totalTxH - PAD_Y
  const perKey = Math.max(SK_H, stateKeys.length > 0
    ? Math.floor((availH - SK_GAP * (stateKeys.length - 1)) / stateKeys.length)
    : SK_H)
  let ky = PAD_Y
  const skLayouts: SkLayout[] = stateKeys.map((ks) => {
    const sl = { ks, y0: ky, y1: ky + perKey }
    ky += perKey + SK_GAP
    return sl
  })

  return { txLayouts, skLayouts, H: Math.max(totalTxH, ky - SK_GAP) + PAD_Y }
}

const MAX_SK_OPTIONS: Array<number | 'all'> = [20, 40, 80, 150, 'all']

// ── Main component ─────────────────────────────────────────────────────────────

export function BlockStateAccessView({ block, onSelectTx }: { block: Block; onSelectTx?: (hash: string | null) => void }) {
  const { blockStateCache, startBlockStateTrace, tokenCache, fetchToken } = useStore()

  const [metric,       setMetric]      = useState<Metric>('priority')
  const [sortOrder,    setSortOrder]   = useState<SortOrder>('index')
  const [storageOnly,  setStorageOnly] = useState(true)
  const [maxKeys,      setMaxKeys]     = useState<number | 'all'>(40)
  const [highlightReadOnly, setHighlightReadOnly] = useState(false)
  const [selectedId,   setSelectedId]  = useState<string | null>(null)
  const [splitMode,    setSplitMode]   = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [selectedFBs,  setSelectedFBs] = useState(() => new Set<number>())

  // Notify parent when a tx bar is selected/deselected
  useEffect(() => {
    if (!onSelectTx) return
    const isTx = selectedId !== null && block.transactions.some(t => t.hash === selectedId)
    onSelectTx(isTx ? selectedId : null)
  }, [selectedId, block.transactions, onSelectTx])

  const containerRef = useRef<HTMLDivElement>(null)
  const svgWrapRef   = useRef<HTMLDivElement>(null)
  const dragStart    = useRef<{ x: number; y: number } | null>(null)
  const [xform, setXform] = useState({ scale: 1, x: 0, y: 0 })

  // ── Fullscreen ──────────────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen()
    else document.exitFullscreen()
  }, [])

  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])

  // ── Data ────────────────────────────────────────────────────────────────────
  const cache = blockStateCache.get(block.number)
  if (!cache) startBlockStateTrace(block.number)

  const progress = cache ? `${cache.done}/${cache.total}` : '0/0'
  const pct      = cache && cache.total > 0 ? cache.done / cache.total : 0

  // ── Flashblock detection ─────────────────────────────────────────────────
  const fbMap   = useMemo(() => detectFlashblocks(block.transactions, block.baseFeePerGas), [block.transactions, block.baseFeePerGas])
  const fbCount = flashblockCount(fbMap)

  // Subset of txResults visible in the selected flashblock(s)
  const filteredTxResults = useMemo((): Map<string, StateAccess[]> | undefined => {
    if (!cache?.txResults || selectedFBs.size === 0) return cache?.txResults
    const m = new Map<string, StateAccess[]>()
    for (const [hash, accesses] of cache.txResults) {
      if (selectedFBs.has(fbMap.get(hash) ?? 0)) m.set(hash, accesses)
    }
    return m
  }, [cache?.txResults, selectedFBs, fbMap])

  // In split mode the right column is always storage slots; account-level is implicit
  const effectiveStorageOnly = splitMode || storageOnly

  const allKeyStats = useMemo(() => {
    if (!filteredTxResults) return []
    return aggregateKeys(filteredTxResults, effectiveStorageOnly)
  }, [filteredTxResults, effectiveStorageOnly])

  const topKeys = useMemo(() => (
    [...allKeyStats]
      .sort((a, b) => b.txCount - a.txCount || a.key.localeCompare(b.key))
      .slice(0, maxKeys === 'all' ? undefined : maxKeys)
      .sort((a, b) => a.key.localeCompare(b.key))
  ), [allKeyStats, maxKeys])

  const isEmpty = topKeys.length === 0

  // ── Address label resolution ─────────────────────────────────────────────────
  // Fetch token details for unique addresses in topKeys (ERC-20 and ERC-721)
  useEffect(() => {
    const seen = new Set<string>()
    for (const ks of topKeys) {
      if (!seen.has(ks.addr) && !KNOWN_PROTOCOLS[ks.addr]) {
        seen.add(ks.addr)
        fetchToken(ks.addr)
      }
    }
  }, [topKeys, fetchToken])

  const addrLabelCached = useCallback((addr: string): string => {
    const proto = KNOWN_PROTOCOLS[addr]
    if (proto) return proto.name
    const entry = tokenCache.get(addr)
    if (entry && typeof entry === 'object') return entry.symbol
    return addrLabel(addr)
  }, [tokenCache])

  // Txs that have no writes among their traced accesses
  const readOnlyTxs = useMemo(() => {
    if (!filteredTxResults) return new Set<string>()
    const s = new Set<string>()
    for (const [hash, accesses] of filteredTxResults) {
      if (accesses.every(a => a.type === 'read' || !a.slot)) s.add(hash)
    }
    return s
  }, [filteredTxResults])

  // ── Zoom / pan ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = svgWrapRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect   = el.getBoundingClientRect()
      const cx     = e.clientX - rect.left
      const cy     = e.clientY - rect.top
      setXform(prev => {
        const factor   = e.deltaY < 0 ? 1.15 : 1 / 1.15
        const newScale = Math.min(8, Math.max(0.2, prev.scale * factor))
        const ratio    = newScale / prev.scale
        return { scale: newScale, x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio }
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [isEmpty])

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragStart.current = { x: e.clientX, y: e.clientY }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragStart.current) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    dragStart.current = { x: e.clientX, y: e.clientY }
    setXform(p => ({ ...p, x: p.x + dx, y: p.y + dy }))
  }
  const onMouseUp = () => { dragStart.current = null }
  const resetZoom  = () => setXform({ scale: 1, x: 0, y: 0 })
  const isZoomed   = xform.scale !== 1 || xform.x !== 0 || xform.y !== 0

  const sortedTxs = useMemo(() => {
    let arr = selectedFBs.size === 0
      ? [...block.transactions]
      : block.transactions.filter(t => selectedFBs.has(fbMap.get(t.hash) ?? 0))
    if (sortOrder === 'gas-desc')      arr.sort((a, b) => Number((b.gasUsed ?? b.gas) - (a.gasUsed ?? a.gas)))
    if (sortOrder === 'priority-desc') arr.sort((a, b) => Number(effectivePriorityFee(b, block.baseFeePerGas) - effectivePriorityFee(a, block.baseFeePerGas)))
    return arr
  }, [block.transactions, sortOrder, selectedFBs, fbMap])

  // Parallelization stats — canonical order, filtered to visible txs
  const parallelStats = useMemo(() => {
    if (!filteredTxResults || cache?.status !== 'done') return null
    const ordered = [...block.transactions]
      .filter(t => filteredTxResults.has(t.hash))
      .sort((a, b) => a.index - b.index)
      .map(t => t.hash)
    return computeParallelization(filteredTxResults, ordered)
  }, [filteredTxResults, cache?.status, block.transactions])

  // Conflict keys: any access (read or write) by tx j after tx i (i < j) wrote the key.
  // Writes imply a read (EVM loads the slot before modifying), so WAW also counts.
  const rawConflictedKeys = useMemo(() => {
    if (!filteredTxResults) return new Set<string>()
    const ordered = [...block.transactions]
      .filter(t => filteredTxResults.has(t.hash))
      .sort((a, b) => a.index - b.index)
      .map(t => t.hash)
    const writtenSoFar = new Set<string>()
    const conflicted   = new Set<string>()
    for (const hash of ordered) {
      const accesses = filteredTxResults.get(hash) ?? []
      for (const acc of accesses) {
        if (writtenSoFar.has(acc.key)) conflicted.add(acc.key)
      }
      for (const acc of accesses) {
        if (acc.type === 'write') writtenSoFar.add(acc.key)
      }
    }
    return conflicted
  }, [filteredTxResults, block.transactions])

  // ── Layout ──────────────────────────────────────────────────────────────────
  const { txLayouts, skLayouts, H } = useMemo(
    () => buildLayout(sortedTxs, topKeys, metric, block.baseFeePerGas),
    [sortedTxs, topKeys, metric, block.baseFeePerGas],
  )

  const W    = splitMode ? W_SPLIT : W_NORMAL
  const COL_SK = splitMode ? COL_SK_S : COL_SK_N

  // ── Split mode: address aggregation ─────────────────────────────────────────
  // (only storage slots can appear here — topKeys always filtered to slots in split mode)
  const addrData = useMemo(() => {
    if (!splitMode || !filteredTxResults) return null
    const topSlotSet = new Set(topKeys.map(k => k.key))

    const txToAddr = new Map<string, Map<string, 'read' | 'write'>>()
    const addrToTx = new Map<string, Set<string>>()
    const addrToWr = new Map<string, Set<string>>()

    for (const [txHash, accesses] of filteredTxResults) {
      for (const acc of accesses) {
        if (!acc.slot || !topSlotSet.has(acc.key)) continue
        if (!txToAddr.has(txHash)) txToAddr.set(txHash, new Map())
        const cur = txToAddr.get(txHash)!.get(acc.addr)
        if (!cur || acc.type === 'write') txToAddr.get(txHash)!.set(acc.addr, acc.type)
        if (!addrToTx.has(acc.addr)) addrToTx.set(acc.addr, new Set())
        addrToTx.get(acc.addr)!.add(txHash)
        if (acc.type === 'write') {
          if (!addrToWr.has(acc.addr)) addrToWr.set(acc.addr, new Set())
          addrToWr.get(acc.addr)!.add(txHash)
        }
      }
    }
    return { txToAddr, addrToTx, addrToWr }
  }, [splitMode, cache?.txResults, topKeys])

  // ── Split mode: address layout ───────────────────────────────────────────────
  const addrLayouts = useMemo((): AddrLayout[] => {
    if (!splitMode || !addrData) return []
    const { addrToTx, addrToWr } = addrData
    const addrs         = [...new Set(topKeys.map(k => k.addr))].sort()
    const totalTxCount  = addrs.reduce((s, a) => s + (addrToTx.get(a)?.size ?? 0), 0) || 1
    const availH        = H - 2 * PAD_Y
    let y = PAD_Y
    return addrs.map(addr => {
      const txCount = addrToTx.get(addr)?.size ?? 0
      const h       = Math.max(SK_H, Math.round(txCount / totalTxCount * availH))
      const al: AddrLayout = { addr, y0: y, y1: y + h, h, txCount, writeCount: addrToWr.get(addr)?.size ?? 0 }
      y += h + SK_GAP
      return al
    })
  }, [splitMode, addrData, topKeys, H])

  // ── Normal mode edges: TX → StateKey ────────────────────────────────────────
  const edges = useMemo((): Edge[] => {
    if (splitMode || !filteredTxResults) return []
    const skMap     = new Map(skLayouts.map(sl => [sl.ks.key, sl]))
    const txCursors = new Map(txLayouts.map(tl => [tl.tx.hash, 0]))
    const skCursors = new Map(skLayouts.map(sl => [sl.ks.key,  0]))
    const topKeySet = new Set(topKeys.map(k => k.key))
    const result: Edge[] = []

    for (const tl of txLayouts) {
      const accesses = filteredTxResults.get(tl.tx.hash)
      if (!accesses) continue
      const byKey = new Map<string, 'read' | 'write'>()
      for (const acc of accesses) {
        if (!topKeySet.has(acc.key)) continue
        if (acc.type === 'write' || !byKey.has(acc.key)) byKey.set(acc.key, acc.type)
      }
      const txAccesses = [...byKey.entries()].map(([key, type]) => ({ key, type })).sort((a, b) => a.key.localeCompare(b.key))
      if (!txAccesses.length) continue

      const sliceH = tl.h / txAccesses.length
      let txCur = txCursors.get(tl.tx.hash) ?? 0
      for (const { key, type } of txAccesses) {
        const sl = skMap.get(key)
        if (!sl) continue
        const skCur      = skCursors.get(key) ?? 0
        const ribbonH_tx = sliceH
        const ribbonH_sk = sl.ks.txCount > 0 ? (sl.y1 - sl.y0) / sl.ks.txCount : sl.y1 - sl.y0
        result.push({ txHash: tl.tx.hash, key, type, ty0: tl.y0 + txCur, ty1: tl.y0 + txCur + ribbonH_tx, sy0: sl.y0 + skCur, sy1: sl.y0 + skCur + ribbonH_sk })
        txCur += ribbonH_tx
        skCursors.set(key, skCur + ribbonH_sk)
      }
      txCursors.set(tl.tx.hash, txCur)
    }
    return result
  }, [splitMode, cache?.txResults, txLayouts, skLayouts, topKeys])

  // ── Split mode edges ─────────────────────────────────────────────────────────
  const { txAddrEdges, addrSlotEdges } = useMemo(() => {
    const empty = { txAddrEdges: [] as TxAddrEdge[], addrSlotEdges: [] as AddrSlotEdge[] }
    if (!splitMode || !addrData || !addrLayouts.length) return empty

    const { txToAddr, addrToTx } = addrData
    const addrMap  = new Map(addrLayouts.map(al => [al.addr, al]))
    const skByAddr = new Map<string, SkLayout[]>()
    for (const sl of skLayouts) {
      if (!skByAddr.has(sl.ks.addr)) skByAddr.set(sl.ks.addr, [])
      skByAddr.get(sl.ks.addr)!.push(sl)
    }

    // TX → Addr
    const txAddrEdgesArr: TxAddrEdge[] = []
    const addrInCursors = new Map(addrLayouts.map(al => [al.addr, 0]))
    for (const tl of txLayouts) {
      const am = txToAddr.get(tl.tx.hash)
      if (!am?.size) continue
      const addrs  = [...am.keys()].sort()
      const sliceH = tl.h / addrs.length
      let txCur = 0
      for (const addr of addrs) {
        const al = addrMap.get(addr)
        if (!al) continue
        const ribbonH_tx   = sliceH
        const ribbonH_addr = al.h / (addrToTx.get(addr)?.size ?? 1)
        const addrIn       = addrInCursors.get(addr) ?? 0
        txAddrEdgesArr.push({ txHash: tl.tx.hash, addr, type: am.get(addr)!, ty0: tl.y0 + txCur, ty1: tl.y0 + txCur + ribbonH_tx, ay0: al.y0 + addrIn, ay1: al.y0 + addrIn + ribbonH_addr })
        txCur += ribbonH_tx
        addrInCursors.set(addr, addrIn + ribbonH_addr)
      }
    }

    // Addr → Slot
    const addrSlotEdgesArr: AddrSlotEdge[] = []
    for (const al of addrLayouts) {
      const slots  = skByAddr.get(al.addr) ?? []
      if (!slots.length) continue
      const sliceH = al.h / slots.length
      let addrOut  = 0
      for (const sl of slots) {
        addrSlotEdgesArr.push({ addr: al.addr, slotKey: sl.ks.key, type: sl.ks.writeCount > 0 ? 'write' : 'read', ay0: al.y0 + addrOut, ay1: al.y0 + addrOut + sliceH, sy0: sl.y0, sy1: sl.y1 })
        addrOut += sliceH
      }
    }

    return { txAddrEdges: txAddrEdgesArr, addrSlotEdges: addrSlotEdgesArr }
  }, [splitMode, addrData, txLayouts, addrLayouts, skLayouts])

  // ── Selection ────────────────────────────────────────────────────────────────
  const hasSel = selectedId !== null

  // Normal 2-col: connected bars on opposite side
  const connectedIds = useMemo(() => {
    if (splitMode || !selectedId) return new Set<string>()
    const s = new Set<string>()
    for (const e of edges) {
      if (e.txHash === selectedId) s.add(e.key)
      if (e.key === selectedId || e.key.startsWith(selectedId + '::')) s.add(e.txHash)
    }
    return s
  }, [splitMode, selectedId, edges])

  // Split 3-col: 2-hop reachability sets
  const splitSel = useMemo(() => {
    if (!splitMode || !selectedId) return null
    const activeTx   = new Set<string>()
    const activeAddr = new Set<string>()
    const activeSlot = new Set<string>()
    const isTx   = sortedTxs.some(t => t.hash === selectedId)
    const isSlot = !isTx && selectedId.includes('::')
    if (isTx) {
      activeTx.add(selectedId)
      for (const e of txAddrEdges) if (e.txHash === selectedId) activeAddr.add(e.addr)
      // Only the specific slots this TX accessed (not all slots of connected addrs)
      const txAccesses  = filteredTxResults?.get(selectedId) ?? []
      const displayedKeys = new Set(topKeys.map(k => k.key))
      for (const acc of txAccesses) {
        if (acc.slot && displayedKeys.has(acc.key)) activeSlot.add(acc.key)
      }
    } else if (isSlot) {
      activeSlot.add(selectedId)
      const addr = selectedId.split('::')[0]
      activeAddr.add(addr)
      // Only txs that actually accessed this specific slot
      for (const [txHash, accesses] of (filteredTxResults ?? [])) {
        if (accesses.some(a => a.key === selectedId)) activeTx.add(txHash)
      }
    } else {
      // addr selected
      activeAddr.add(selectedId)
      for (const e of txAddrEdges)   if (e.addr === selectedId) activeTx.add(e.txHash)
      for (const e of addrSlotEdges) if (e.addr === selectedId) activeSlot.add(e.slotKey)
    }
    return { activeTx, activeAddr, activeSlot }
  }, [splitMode, selectedId, sortedTxs, txAddrEdges, addrSlotEdges, cache?.txResults, topKeys])

  // Active checks
  const isTxActive   = (h: string) => {
    if (highlightReadOnly) return readOnlyTxs.has(h)
    return !hasSel || (splitMode ? (splitSel?.activeTx.has(h) ?? false) : h === selectedId || connectedIds.has(h))
  }
  const isAddrActive = (a: string) => !hasSel || (splitSel?.activeAddr.has(a)   ?? false)
  const isSkActive   = (k: string) => !hasSel || (splitMode
    ? (splitSel?.activeSlot.has(k) ?? false)
    : k === selectedId || k.startsWith(selectedId! + '::') || connectedIds.has(k))

  // Only highlight ribbons that directly involve the selected node — not all ribbons
  // touching any connected node (those bars stay un-dimmed, but their other bands stay faint).
  const edgeActive_normal = (e: Edge)         => !hasSel || e.txHash === selectedId || e.key === selectedId || e.key.startsWith(selectedId! + '::')
  const edgeActive_txAddr = (e: TxAddrEdge) => {
    if (!hasSel) return true
    if (splitSel) return splitSel.activeTx.has(e.txHash) && splitSel.activeAddr.has(e.addr)
    return e.txHash === selectedId || e.addr === selectedId
  }
  const edgeActive_addrSl = (e: AddrSlotEdge) => {
    if (!hasSel) return true
    if (splitSel) return splitSel.activeAddr.has(e.addr) && splitSel.activeSlot.has(e.slotKey)
    return e.addr === selectedId || e.slotKey === selectedId
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} style={{ padding: '8px 0', ...(isFullscreen ? { background: 'var(--surface1)', overflowY: 'auto', padding: '12px' } : {}) }}>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, padding: '0 12px 6px', fontSize: 9, color: 'var(--text3)', alignItems: 'center', flexWrap: 'wrap' }}>

        {/* Progress */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {cache?.status === 'done' ? '✓ done' : `tracing ${progress} txs`}
          </span>
          {cache?.status === 'running' && (
            <div style={{ width: 80, height: 3, background: 'var(--surface3)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${pct * 100}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.2s' }} />
            </div>
          )}
          {cache && cache.errors.size > 0 && <span style={{ color: 'var(--red)' }}>{cache.errors.size} failed</span>}
        </div>

        {/* Flashblock filter */}
        {fbCount > 1 && (
          <>
            <span style={{ color: 'var(--border)' }}>·</span>
            <span>fb:</span>
            <button
              className={`topbar-btn ${selectedFBs.size === 0 ? 'active' : ''}`}
              style={{ fontSize: 8, padding: '1px 5px' }}
              onClick={() => setSelectedFBs(new Set())}
            >all</button>
            {Array.from({ length: fbCount }, (_, i) => (
              <button
                key={i}
                className={`topbar-btn ${selectedFBs.has(i) ? 'active' : ''}`}
                style={{ fontSize: 8, padding: '1px 5px' }}
                title={`Flashblock ${i}${i === 0 ? ' (system tx)' : ''}`}
                onClick={() => setSelectedFBs(prev => {
                  const next = new Set(prev)
                  if (next.has(i)) next.delete(i); else next.add(i)
                  return next
                })}
              >{i}</button>
            ))}
          </>
        )}

        <span style={{ color: 'var(--border)' }}>·</span>
        <span>TX scale:</span>
        {(['gas', 'fee', 'priority', 'equal'] as Metric[]).map(m => (
          <button key={m} className={`topbar-btn ${metric === m ? 'active' : ''}`} style={{ fontSize: 8, padding: '1px 5px' }} onClick={() => setMetric(m)}>{m}</button>
        ))}

        <span style={{ color: 'var(--border)' }}>·</span>
        <span>TX order:</span>
        {([['index', 'block'], ['gas-desc', 'gas↓'], ['priority-desc', 'tip↓']] as [SortOrder, string][]).map(([s, l]) => (
          <button key={s} className={`topbar-btn ${sortOrder === s ? 'active' : ''}`} style={{ fontSize: 8, padding: '1px 5px' }} onClick={() => setSortOrder(s)}>{l}</button>
        ))}

        <span style={{ color: 'var(--border)' }}>·</span>
        {!splitMode && (
          <button className={`topbar-btn ${storageOnly ? 'active' : ''}`}
            style={{ fontSize: 8, padding: '1px 5px' }}
            onClick={() => setStorageOnly(v => !v)}
            title="Show only storage slot accesses (addr::slot). Account-level reads hidden.">
            storage only
          </button>
        )}
        <button className={`topbar-btn ${splitMode ? 'active' : ''}`}
          style={{ fontSize: 8, padding: '1px 5px' }}
          onClick={() => { setSplitMode(v => !v); setSelectedId(null) }}
          title="3-column mode: Transactions → Addresses → Storage Slots">
          addr split
        </button>

        <span style={{ color: 'var(--border)' }}>·</span>
        <span>top keys:</span>
        {MAX_SK_OPTIONS.map(n => (
          <button key={n} className={`topbar-btn ${maxKeys === n ? 'active' : ''}`} style={{ fontSize: 8, padding: '1px 5px' }} onClick={() => setMaxKeys(n)}>{n}</button>
        ))}

        <span style={{ color: 'var(--border)' }}>·</span>
        <button
          className={`topbar-btn ${highlightReadOnly ? 'active' : ''}`}
          style={{ fontSize: 8, padding: '1px 5px' }}
          title="Highlight transactions that only read state (no writes)"
          onClick={() => { setHighlightReadOnly(v => !v); setSelectedId(null) }}
        >read-only txs</button>

        <span style={{ color: 'var(--border)', margin: '0 4px' }}>·</span>
        <span><span style={{ color: COLOR_READ }}>■</span> read</span>
        <span><span style={{ color: COLOR_WRITE }}>■</span> write</span>
        <span title="Red border on state key bar = Read-After-Write conflict"><span style={{ color: COLOR_WRITE, fontFamily: 'monospace' }}>□</span> RAW</span>

        {parallelStats && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }} title={
            `Critical path: ${parallelStats.criticalPath} sequential batches minimum\n` +
            `Max concurrent: ${parallelStats.maxConcurrent} txs in the widest batch\n` +
            `Conflicted: ${parallelStats.conflictedTxs}/${parallelStats.totalTxs} txs depend on a prior write`
          }>
            <span>
              score{' '}
              <span style={{ color: parallelStats.score >= 0.8 ? '#4caf7d' : parallelStats.score >= 0.5 ? '#ffb74d' : '#ff5252', fontWeight: 'bold' }}>
                {(parallelStats.score * 100).toFixed(0)}%
              </span>
            </span>
            <span style={{ color: 'var(--border)' }}>·</span>
            <span>chain <span style={{ fontWeight: 'bold' }}>{parallelStats.criticalPath}</span></span>
            <span style={{ color: 'var(--border)' }}>·</span>
            <span>peak <span style={{ fontWeight: 'bold' }}>{parallelStats.maxConcurrent}</span></span>
            <span style={{ color: 'var(--border)' }}>·</span>
            <span>{parallelStats.conflictedTxs}/{parallelStats.totalTxs} conflicted</span>
          </span>
        )}
        {!parallelStats && allKeyStats.length > 0 && (
          <span style={{ marginLeft: 'auto' }}>
            {allKeyStats.length} state keys · {allKeyStats.filter(k => k.writeCount > 1).length} contended writes
          </span>
        )}

        {isZoomed && (
          <button className="topbar-btn" style={{ fontSize: 8, padding: '1px 5px' }} onClick={resetZoom}>reset zoom</button>
        )}
        <button className="topbar-btn" style={{ fontSize: 8, padding: '1px 5px', marginLeft: allKeyStats.length > 0 ? 4 : 'auto' }}
          onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          {isFullscreen ? '⊡' : '⊞'}
        </button>
      </div>

      {/* Empty state */}
      {isEmpty && cache && cache.done === cache.total && cache.done > 0 && (
        <div className="muted" style={{ padding: '12px 16px', fontSize: 10 }}>
          No state accesses found.{!storageOnly && ' Try enabling "storage only" filter.'}
        </div>
      )}

      {/* SVG — zoom/pan container */}
      {!isEmpty && (
        <div
          ref={svgWrapRef}
          style={{ overflow: 'hidden', cursor: 'grab', userSelect: 'none' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <div style={{ transform: `translate(${xform.x}px, ${xform.y}px) scale(${xform.scale})`, transformOrigin: '0 0' }}>
            <svg
              width="100%" viewBox={`0 0 ${W} ${H}`}
              style={{ display: 'block', overflow: 'visible' }}
              onClick={() => setSelectedId(null)}
            >
              {/* Column headers */}
              <text x={COL_TX   + BAR_W / 2} y={10} fontSize={8} fill="var(--text3)" textAnchor="middle">Transactions</text>
              {splitMode && <text x={COL_ADDR + BAR_W / 2} y={10} fontSize={8} fill="var(--text3)" textAnchor="middle">Addresses</text>}
              <text x={COL_SK   + BAR_W / 2} y={10} fontSize={8} fill="var(--text3)" textAnchor="middle">{splitMode ? 'Storage Slots' : 'State Keys'}</text>

              {/* Flashblock boundary lines — only in block order with all FBs visible */}
              {sortOrder === 'index' && selectedFBs.size === 0 && txLayouts.map((tl, i) => {
                const nextFB = i + 1 < txLayouts.length ? fbMap.get(txLayouts[i + 1].tx.hash) : undefined
                const thisFB = fbMap.get(tl.tx.hash)
                if (nextFB === undefined || nextFB === thisFB) return null
                const lineY = (tl.y1 + txLayouts[i + 1].y0) / 2
                return (
                  <g key={`fb-boundary-${i}`}>
                    <line x1={0} y1={lineY} x2={W} y2={lineY} stroke="var(--accent)" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.5} />
                    <text x={COL_TX - 2} y={lineY - 1} fontSize={6.5} fill="var(--accent)" textAnchor="end" opacity={0.7}>fb{nextFB}</text>
                  </g>
                )
              })}

              {/* ── Normal mode ribbons ── */}
              {!splitMode && edges.map((e, i) => {
                const active = edgeActive_normal(e)
                const color  = e.type === 'write' ? COLOR_WRITE : COLOR_READ
                return (
                  <path key={i}
                    d={bandPath(COL_TX + BAR_W, e.ty0, e.ty1, COL_SK, e.sy0, e.sy1)}
                    fill={color} opacity={active ? (e.type === 'write' ? 0.35 : 0.20) : 0.03}
                    style={{ cursor: 'pointer' }}
                    onClick={ev => { ev.stopPropagation(); setSelectedId(p => p === e.txHash ? null : e.txHash) }}
                  >
                    <title>tx {e.txHash.slice(0, 10)}… → {e.key.length > 60 ? e.key.slice(0, 42) + '::…' + e.key.slice(-8) : e.key}{'\n'}{e.type.toUpperCase()}</title>
                  </path>
                )
              })}

              {/* ── Split mode: TX → Addr ribbons ── */}
              {splitMode && txAddrEdges.map((e, i) => {
                const active = edgeActive_txAddr(e)
                const color  = e.type === 'write' ? COLOR_WRITE : COLOR_READ
                return (
                  <path key={`ta${i}`}
                    d={bandPath(COL_TX + BAR_W, e.ty0, e.ty1, COL_ADDR, e.ay0, e.ay1)}
                    fill={color} opacity={active ? (e.type === 'write' ? 0.35 : 0.20) : 0.03}
                    style={{ cursor: 'pointer' }}
                    onClick={ev => { ev.stopPropagation(); setSelectedId(p => p === e.txHash ? null : e.txHash) }}
                  >
                    <title>tx {e.txHash.slice(0, 10)}… → {addrLabelCached(e.addr)}{'\n'}{e.type.toUpperCase()}</title>
                  </path>
                )
              })}

              {/* ── Split mode: Addr → Slot ribbons ── */}
              {splitMode && addrSlotEdges.map((e, i) => {
                const active = edgeActive_addrSl(e)
                const color  = e.type === 'write' ? COLOR_WRITE : COLOR_READ
                return (
                  <path key={`as${i}`}
                    d={bandPath(COL_ADDR + BAR_W, e.ay0, e.ay1, COL_SK, e.sy0, e.sy1)}
                    fill={color} opacity={active ? (e.type === 'write' ? 0.30 : 0.18) : 0.03}
                    style={{ cursor: 'pointer' }}
                    onClick={ev => { ev.stopPropagation(); setSelectedId(p => p === e.addr ? null : e.addr) }}
                  >
                    <title>{addrLabelCached(e.addr)} → …{e.slotKey.slice(-8)}{'\n'}{e.type.toUpperCase()}</title>
                  </path>
                )
              })}

              {/* ── TX bars ── */}
              {txLayouts.map(({ tx, y0, y1, h }) => {
                const sel       = selectedId === tx.hash
                const dim       = !isTxActive(tx.hash)
                const fromAddr  = tx.from || tx.hash
                const color     = keyToHsl(fromAddr)
                const hasResult = cache?.txResults.has(tx.hash)
                const hasError  = cache?.errors.has(tx.hash)
                const label     = tx.from ? shortAddr(tx.from, 3) : shortAddr(tx.hash, 3)
                const target    = tx.to ? (KNOWN_PROTOCOLS[tx.to]?.name ?? shortAddr(tx.to, 3)) : 'deploy'
                return (
                  <g key={tx.hash} opacity={dim ? 0.25 : 1}>
                    <rect
                      x={COL_TX} y={y0} width={BAR_W} height={Math.max(1, h)} rx={1}
                      fill={hasError ? 'var(--red)' : hasResult ? color : 'var(--surface3)'}
                      stroke={sel ? 'var(--text)' : 'none'} strokeWidth={1}
                      style={{ cursor: 'pointer' }}
                      onClick={ev => { ev.stopPropagation(); setSelectedId(p => p === tx.hash ? null : tx.hash) }}
                    >
                      <title>#{tx.index} {tx.hash}{'\n'}from: {tx.from}{'\n'}to: {tx.to ?? 'deploy'}{'\n'}{metricLabel(metric, tx, block.baseFeePerGas)}</title>
                    </rect>
                    {h >= 10 && (
                      <text
                        x={COL_TX - 3} y={y0 + h / 2 + 3}
                        fontSize={7} fill="var(--text3)" textAnchor="end" fontFamily="monospace"
                        style={{ cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={ev => { ev.stopPropagation(); window.open(`https://basescan.org/tx/${tx.hash}`, '_blank', 'noopener') }}
                      >{label}→{target}</text>
                    )}
                  </g>
                )
              })}

              {/* ── Split mode: Address bars ── */}
              {splitMode && addrLayouts.map(al => {
                const sel  = selectedId === al.addr
                const dim  = !isAddrActive(al.addr)
                const color = keyToHsl(al.addr)
                const mid  = (al.y0 + al.y1) / 2
                return (
                  <g key={al.addr} opacity={dim ? 0.2 : 1}>
                    <rect
                      x={COL_ADDR} y={al.y0} width={BAR_W} height={Math.max(1, al.h)} rx={1}
                      fill={color}
                      stroke={sel ? 'var(--text)' : al.writeCount > 0 ? COLOR_WRITE : 'none'}
                      strokeWidth={1}
                      style={{ cursor: 'pointer' }}
                      onClick={ev => { ev.stopPropagation(); setSelectedId(p => p === al.addr ? null : al.addr) }}
                    >
                      <title>{al.addr}{'\n'}{al.txCount} txs · {al.writeCount} write txs</title>
                    </rect>
                    {al.h >= 8 && (
                      <text
                        x={COL_ADDR - 3} y={mid + 3}
                        fontSize={7} fill="var(--text2)" textAnchor="end"
                        style={{ cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={ev => { ev.stopPropagation(); window.open(`https://basescan.org/address/${al.addr}`, '_blank', 'noopener') }}
                      >{addrLabelCached(al.addr)}</text>
                    )}
                  </g>
                )
              })}

              {/* ── State key / slot bars ── */}
              {skLayouts.map(({ ks, y0, y1 }) => {
                const sel      = selectedId === ks.key || selectedId === ks.addr
                const dim      = !isSkActive(ks.key)
                const barColor = keyToHsl(ks.addr)
                const mid      = (y0 + y1) / 2
                const lbl      = keyLabel(ks, addrLabelCached)
                const hasRaw = rawConflictedKeys.has(ks.key)
                return (
                  <g key={ks.key} opacity={dim ? 0.2 : 1}>
                    <rect
                      x={COL_SK} y={y0} width={BAR_W} height={Math.max(1, y1 - y0)} rx={1}
                      fill={ks.slot ? barColor : 'var(--text3)'}
                      stroke={sel ? 'var(--text)' : hasRaw ? COLOR_WRITE : 'none'}
                      strokeWidth={hasRaw ? 0.8 : 1}
                      style={{ cursor: 'pointer' }}
                      onClick={ev => { ev.stopPropagation(); setSelectedId(p => p === ks.key ? null : ks.key) }}
                    >
                      <title>{ks.key}{'\n'}{ks.txCount} tx{ks.txCount !== 1 ? 's' : ''} · {ks.writeCount} write{ks.writeCount !== 1 ? 's' : ''} · {ks.readCount} read{ks.readCount !== 1 ? 's' : ''}</title>
                    </rect>
                    <text
                      x={COL_SK + BAR_W + 4} y={mid + 3}
                      fontSize={7} fill={ks.slot ? 'var(--text2)' : 'var(--text3)'}
                      textAnchor="start" fontFamily={ks.slot ? undefined : 'monospace'}
                      style={{ cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={ev => { ev.stopPropagation(); window.open(`https://basescan.org/address/${ks.addr}`, '_blank', 'noopener') }}
                    >
                      {splitMode
                        ? ('…' + (ks.slot ?? ks.addr).slice(-8))
                        : (<>{lbl.top}{lbl.sub && <tspan fill="var(--text3)" fontFamily="monospace"> {lbl.sub}</tspan>}</>)
                      }
                    </text>
                    <text
                      x={COL_SK + BAR_W + 4} y={mid + 11}
                      fontSize={6.5} fill="var(--text3)" textAnchor="start" style={{ pointerEvents: 'none' }}
                    >
                      {ks.txCount}tx
                      {ks.writeCount > 0 && <tspan fill={COLOR_WRITE}> {ks.writeCount}w</tspan>}
                      {ks.readCount  > 0 && <tspan fill={COLOR_READ}> {ks.readCount}r</tspan>}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>
        </div>
      )}
    </div>
  )
}
