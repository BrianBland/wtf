import { useState } from 'react'

type ListMode = 'collapsed' | 'short' | 'full'

interface CollapsibleListProps<T> {
  items: T[]
  renderItem: (item: T, index: number) => React.ReactNode
  pageSize?: number
  defaultMode?: ListMode
  label?: string
  emptyMessage?: string
}

export function CollapsibleList<T>({
  items,
  renderItem,
  pageSize = 5,
  defaultMode = 'short',
  label = 'items',
  emptyMessage = 'No items',
}: CollapsibleListProps<T>) {
  const [mode, setMode] = useState<ListMode>(items.length === 0 ? 'collapsed' : defaultMode)
  const [page, setPage] = useState(0)

  if (items.length === 0) {
    return <div className="empty-state" style={{ padding: '12px 16px', fontSize: 11 }}>{emptyMessage}</div>
  }

  if (mode === 'collapsed') {
    return (
      <div
        className="clist-toggle"
        onClick={() => setMode('short')}
        style={{ justifyContent: 'center' }}
      >
        ▶ Show {items.length.toLocaleString()} {label}
      </div>
    )
  }

  const visible = mode === 'full'
    ? items
    : items.slice(page * pageSize, page * pageSize + pageSize)

  const totalPages = Math.ceil(items.length / pageSize)

  return (
    <>
      {visible.map((item, i) => renderItem(item, page * pageSize + i))}

      {/* Footer controls */}
      <div className="clist-toggle">
        {mode === 'short' && (
          <>
            {items.length > pageSize && (
              <>
                <button
                  className="nav-btn"
                  disabled={page === 0}
                  onClick={(e) => { e.stopPropagation(); setPage((p) => p - 1) }}
                >←</button>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                  {page + 1}/{totalPages}
                </span>
                <button
                  className="nav-btn"
                  disabled={page >= totalPages - 1}
                  onClick={(e) => { e.stopPropagation(); setPage((p) => p + 1) }}
                >→</button>
                <span className="inline-sep">·</span>
              </>
            )}
            <span
              style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: 10 }}
              onClick={() => setMode('full')}
            >Show all {items.length.toLocaleString()}</span>
            <span className="ml-auto">
              <span
                style={{ cursor: 'pointer' }}
                onClick={() => setMode('collapsed')}
              >▲ Collapse</span>
            </span>
          </>
        )}

        {mode === 'full' && (
          <>
            <span className="dim">{items.length.toLocaleString()} total</span>
            <span className="ml-auto">
              <span
                style={{ cursor: 'pointer', color: 'var(--text2)', fontSize: 10 }}
                onClick={() => { setMode('short'); setPage(0) }}
              >▲ Collapse</span>
            </span>
          </>
        )}
      </div>
    </>
  )
}
