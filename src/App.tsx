import { useEffect } from 'react'
import { useStore } from './store'
import { NavState } from './types'
import { ConfigScreen }    from './components/ConfigScreen'
import { BlockRangeView }  from './components/BlockRangeView'
import { BlockView }       from './components/BlockView'
import { TxView }          from './components/TxView'
import { formatAge } from './lib/formatters'

// ── Hash-based routing ────────────────────────────────────────────────────

function parseHash(hash: string): NavState {
  const h = hash.replace(/^#\/?/, '')
  if (h === 'range') return { view: 'range' }
  const blockM = h.match(/^block\/(\d+)$/)
  if (blockM) return { view: 'block', blockNumber: parseInt(blockM[1]) }
  const txM = h.match(/^tx\/([^/]+)(?:\/(\d+))?$/)
  if (txM) return { view: 'tx', txHash: txM[1], blockNumber: txM[2] ? parseInt(txM[2]) : undefined }
  return { view: 'config' }
}

function navToHash(nav: NavState): string {
  if (nav.view === 'range') return '#range'
  if (nav.view === 'block' && nav.blockNumber !== undefined) return `#block/${nav.blockNumber}`
  if (nav.view === 'tx' && nav.txHash) {
    return nav.blockNumber !== undefined
      ? `#tx/${nav.txHash}/${nav.blockNumber}`
      : `#tx/${nav.txHash}`
  }
  return '#'
}

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
  const { nav, goto, connected, initialized } = useStore()

  // On mount: read hash → set initial nav state
  useEffect(() => {
    const initial = parseHash(window.location.hash)
    if (initial.view !== 'config') goto(initial)

    const onHashChange = () => {
      const next = parseHash(window.location.hash)
      goto(next)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Keep hash in sync with nav (skip if it already matches to avoid loops)
  useEffect(() => {
    const desired = navToHash(nav)
    if (window.location.hash !== desired) {
      window.history.pushState(null, '', desired)
    }
  }, [nav])

  // Auto-navigate to range view after first connect (only if on config/default)
  useEffect(() => {
    if (initialized && nav.view === 'config') goto({ view: 'range' })
  }, [initialized])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-logo">Watch Token Flows</div>

        {nav.view !== 'config' && (
          <nav className="topbar-nav">
            <button
              className={`topbar-btn ${nav.view === 'range' ? 'active' : ''}`}
              onClick={() => goto({ view: 'range' })}
            >Block Range</button>
            <button
              className={`topbar-btn ${nav.view === 'block' ? 'active' : ''}`}
              onClick={() => nav.view === 'block' ? undefined : undefined}
              style={{ opacity: nav.view === 'block' ? 1 : 0.4 }}
            >Block {nav.blockNumber ? `#${nav.blockNumber.toLocaleString()}` : ''}</button>
            <button
              className={`topbar-btn ${nav.view === 'tx' ? 'active' : ''}`}
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
          <BlockView blockNumber={nav.blockNumber} />
        )}
        {nav.view === 'tx' && nav.txHash && nav.blockNumber !== undefined && (
          <TxView txHash={nav.txHash} blockNumber={nav.blockNumber} />
        )}
        {(nav.view === 'range' || nav.view === 'block') && !initialized && (connected || !connected) && (
          <div className="empty-state">
            {connected ? 'Loading block data…' : 'Connect to an RPC to load blocks'}<br />
            <div className="shimmer" style={{ width: 200, margin: '12px auto' }} />
          </div>
        )}
      </main>
    </div>
  )
}
