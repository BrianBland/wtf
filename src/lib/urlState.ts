import { BlockSortKey, BlockTxFilter, BlockViewFilters, NavState } from '../types'

export const DEFAULT_BLOCK_VIEW_FILTERS: BlockViewFilters = {
  txTypeFilter: 'all',
  histFilter: {
    sender: null,
    recipient: null,
    selector: null,
  },
  textFilter: '',
  sortBy: 'txs',
}

function cloneDefaultBlockFilters(): BlockViewFilters {
  return {
    txTypeFilter: DEFAULT_BLOCK_VIEW_FILTERS.txTypeFilter,
    histFilter: { ...DEFAULT_BLOCK_VIEW_FILTERS.histFilter },
    textFilter: DEFAULT_BLOCK_VIEW_FILTERS.textFilter,
    sortBy: DEFAULT_BLOCK_VIEW_FILTERS.sortBy,
  }
}

export function normalizeBlockFilters(filters?: Partial<BlockViewFilters> | null): BlockViewFilters {
  const next = cloneDefaultBlockFilters()
  if (!filters) return next

  const txTypeFilter = filters.txTypeFilter
  if (txTypeFilter && ['all', 'eth', 'tokens', 'defi'].includes(txTypeFilter)) {
    next.txTypeFilter = txTypeFilter as BlockTxFilter
  }

  if (filters.histFilter) {
    next.histFilter = {
      sender: filters.histFilter.sender ?? null,
      recipient: filters.histFilter.recipient ?? null,
      selector: filters.histFilter.selector ?? null,
    }
  }

  if (typeof filters.textFilter === 'string') next.textFilter = filters.textFilter
  if (filters.sortBy === 'gas' || filters.sortBy === 'txs') next.sortBy = filters.sortBy as BlockSortKey

  return next
}

function parseBlockFilters(params: URLSearchParams): BlockViewFilters {
  const typeParam = params.get('type')
  return normalizeBlockFilters({
    txTypeFilter: typeParam && ['all', 'eth', 'tokens', 'defi'].includes(typeParam)
      ? typeParam as BlockTxFilter
      : undefined,
    histFilter: {
      sender: params.get('from'),
      recipient: params.get('to'),
      selector: params.get('sel'),
    },
    textFilter: params.get('q') ?? '',
    sortBy: (params.get('sort') === 'gas' ? 'gas' : 'txs') as BlockSortKey,
  })
}

function formatBlockFilterQuery(filters?: BlockViewFilters): string {
  const normalized = normalizeBlockFilters(filters)
  const params = new URLSearchParams()

  if (normalized.txTypeFilter !== 'all') params.set('type', normalized.txTypeFilter)
  if (normalized.histFilter.sender) params.set('from', normalized.histFilter.sender)
  if (normalized.histFilter.recipient) params.set('to', normalized.histFilter.recipient)
  if (normalized.histFilter.selector) params.set('sel', normalized.histFilter.selector)
  if (normalized.textFilter) params.set('q', normalized.textFilter)
  if (normalized.sortBy !== 'txs') params.set('sort', normalized.sortBy)

  const query = params.toString()
  return query ? `?${query}` : ''
}

function splitHash(hash: string): { path: string; params: URLSearchParams | null } {
  const trimmed = hash.replace(/^#\/?/, '')
  if (!trimmed) return { path: '', params: null }

  const queryIndex = trimmed.indexOf('?')
  if (queryIndex === -1) return { path: trimmed, params: null }

  return {
    path: trimmed.slice(0, queryIndex),
    params: new URLSearchParams(trimmed.slice(queryIndex + 1)),
  }
}

export function parseLocation(location: { hash: string; search: string }): NavState {
  const { path, params: hashParams } = splitHash(location.hash)
  const params = hashParams ?? new URLSearchParams(location.search)
  const blockFilters = parseBlockFilters(params)

  if (path === 'range') return { view: 'range', blockFilters }

  const nestedTxMatch = path.match(/^block\/(\d+)\/tx\/([^/]+)$/)
  if (nestedTxMatch) {
    return {
      view: 'tx',
      blockNumber: parseInt(nestedTxMatch[1], 10),
      txHash: nestedTxMatch[2],
      blockFilters,
    }
  }

  const blockMatch = path.match(/^block\/(\d+)$/)
  if (blockMatch) {
    return {
      view: 'block',
      blockNumber: parseInt(blockMatch[1], 10),
      blockFilters,
    }
  }

  const txMatch = path.match(/^tx\/([^/]+)(?:\/(\d+))?$/)
  if (txMatch) {
    return {
      view: 'tx',
      txHash: txMatch[1],
      blockNumber: txMatch[2] ? parseInt(txMatch[2], 10) : undefined,
      blockFilters,
    }
  }

  return { view: 'config', blockFilters }
}

export function formatHash(nav: NavState): string {
  if (nav.view === 'range') return '#/range'

  if (nav.view === 'block' && nav.blockNumber !== undefined) {
    return `#/block/${nav.blockNumber}${formatBlockFilterQuery(nav.blockFilters)}`
  }

  if (nav.view === 'tx' && nav.txHash) {
    return nav.blockNumber !== undefined
      ? `#/block/${nav.blockNumber}/tx/${nav.txHash}`
      : `#/tx/${nav.txHash}`
  }

  return '#/'
}

export function carryBlockFilters(current: NavState, next: NavState): NavState {
  if (next.blockFilters) return { ...next, blockFilters: normalizeBlockFilters(next.blockFilters) }
  if (current.blockFilters) return { ...next, blockFilters: normalizeBlockFilters(current.blockFilters) }
  return next
}

export function blockFiltersEqual(a?: BlockViewFilters, b?: BlockViewFilters): boolean {
  const left = normalizeBlockFilters(a)
  const right = normalizeBlockFilters(b)

  return (
    left.txTypeFilter === right.txTypeFilter
    && left.histFilter.sender === right.histFilter.sender
    && left.histFilter.recipient === right.histFilter.recipient
    && left.histFilter.selector === right.histFilter.selector
    && left.textFilter === right.textFilter
    && left.sortBy === right.sortBy
  )
}
