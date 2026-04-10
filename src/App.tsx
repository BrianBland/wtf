import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { ConfigScreen }    from './components/ConfigScreen'
import { BlockRangeView }  from './components/BlockRangeView'
import { BlockView }       from './components/BlockView'
import { TxView }          from './components/TxView'
import { formatAge } from './lib/formatters'
import {
  DEFAULT_BLOCK_VIEW_FILTERS,
  blockFiltersEqual,
  carryBlockFilters,
  formatHash,
  normalizeBlockFilters,
  parseLocation,
} from './lib/urlState'

// ── Status widgets ────────────────────────────────────────────────────────

function ConnectionStatus() {
  const { connected, connecting, connError } = useStore()
  let cls = 'conn-dot'
  let label = 'Disconnected'
  if (connecting) { cls += ' connecting'; label = 'Connecting…' }
  else if (connected) { cls += ' connected'; label = 'Connected' }
  else if (connError) { cls += ' error'; label = 'Error' }

  return (
    <div className="conn-status">
      <div className={cls} title={connError ?? label} />
      <span>{label}</span>
    </div>
  )
}

function BlockTicker() {
  const { latestBlock, blocks } = useStore()
  if (!latestBlock) return null
  const block = blocks.get(latestBlock)
  return (
    <div className="block-ticker">
      <strong>#{latestBlock.toLocaleString()}</strong>
      {block && <span className="dim"> · {formatAge(block.timestamp)}</span>}
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────

export default function App() {
  const { nav, goto, initialized, connect, connected } = useStore()
  const [urlHydrated, setUrlHydrated] = useState(false)
  const prevNavRef = useRef<typeof nav | null>(null)

  // On mount: read the full URL → set initial nav state + auto-connect if not on config.
  useEffect(() => {
    const initial = parseLocation(window.location)
    if (initial.view !== 'config') {
      goto(initial)
      connect()  // auto-connect using saved (or default) RPC URL
    }
    setUrlHydrated(true)

    const onHashChange = () => {
      const next = parseLocation(window.location)
      goto(next)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Keep the canonical hash-only URL in sync with nav.
  useEffect(() => {
    if (!urlHydrated) return

    const desiredHash = formatHash(nav)
    const desiredUrl = `${window.location.pathname}${desiredHash}`
    const alreadySynced = window.location.hash === desiredHash && window.location.search === ''

    if (alreadySynced) {
      prevNavRef.current = nav
      return
    }

    const prevNav = prevNavRef.current
    const filtersOnlyChange = prevNav !== null
      && prevNav.view === nav.view
      && prevNav.blockNumber === nav.blockNumber
      && prevNav.txHash === nav.txHash
      && !blockFiltersEqual(prevNav.blockFilters, nav.blockFilters)

    const historyMethod = prevNav === null || filtersOnlyChange ? 'replaceState' : 'pushState'
    window.history[historyMethod](null, '', desiredUrl)
    prevNavRef.current = nav
  }, [nav, urlHydrated])

  // Auto-navigate to range view after first connect (only if on config/default)
  useEffect(() => {
    if (initialized && nav.view === 'config') goto(carryBlockFilters(nav, { view: 'range' }))
  }, [initialized])

  const blockFilters = normalizeBlockFilters(nav.blockFilters ?? DEFAULT_BLOCK_VIEW_FILTERS)

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-logo">Watch Token Flows</div>

        {nav.view !== 'config' && (
          <nav className="topbar-nav">
            <button
              className={`topbar-btn ${nav.view === 'range' ? 'active' : ''}`}
              onClick={() => goto(carryBlockFilters(nav, { view: 'range' }))}
            >Block Range</button>
            <button
              className={`topbar-btn ${nav.view === 'block' ? 'active' : ''}`}
              disabled={nav.blockNumber === undefined || nav.view === 'block'}
              onClick={() => {
                if (nav.blockNumber !== undefined) {
                  goto(carryBlockFilters(nav, { view: 'block', blockNumber: nav.blockNumber }))
                }
              }}
              style={{ opacity: nav.view === 'block' ? 1 : 0.4 }}
            >Block {nav.blockNumber ? `#${nav.blockNumber.toLocaleString()}` : ''}</button>
            <button
              className={`topbar-btn ${nav.view === 'tx' ? 'active' : ''}`}
              disabled={nav.txHash === undefined || nav.blockNumber === undefined || nav.view === 'tx'}
              onClick={() => {
                if (nav.txHash && nav.blockNumber !== undefined) {
                  goto(carryBlockFilters(nav, { view: 'tx', txHash: nav.txHash, blockNumber: nav.blockNumber }))
                }
              }}
              style={{ opacity: nav.view === 'tx' ? 1 : 0.4 }}
            >Tx {nav.txHash ? nav.txHash.slice(0, 10) + '…' : ''}</button>
          </nav>
        )}

        <div className="topbar-right">
          {nav.view !== 'config' && <BlockTicker />}
          <ConnectionStatus />
          {nav.view !== 'config' && (
            <button
              className="nav-btn"
              onClick={() => goto({ view: 'config' })}
              title="Settings"
            >⚙</button>
          )}
        </div>
      </header>

      <main className="main-content">
        {nav.view === 'config' && <ConfigScreen />}
        {nav.view === 'range' && initialized && <BlockRangeView />}
        {nav.view === 'block' && nav.blockNumber !== undefined && (
          <BlockView
            blockNumber={nav.blockNumber}
            filters={blockFilters}
            onFiltersChange={(next) => goto({ ...nav, blockFilters: next })}
          />
        )}
        {nav.view === 'tx' && nav.txHash && nav.blockNumber !== undefined && (
          <TxView txHash={nav.txHash} blockNumber={nav.blockNumber} />
        )}
        {nav.view !== 'config' && !initialized && (
          <div className="empty-state">
            {connected ? 'Loading block data…' : 'Connect to an RPC to load blocks'}<br />
            <div className="shimmer" style={{ width: 200, margin: '12px auto' }} />
          </div>
        )}
      </main>
    </div>
  )
}
