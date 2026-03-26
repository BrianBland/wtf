import { useState } from 'react'
import { useStore } from '../store'

const PRESETS = [
  { label: 'dRPC (free)', url: 'wss://base.drpc.org' },
  { label: 'PublicNode (free)', url: 'wss://base-rpc.publicnode.com' },
  { label: 'Alchemy (template)', url: 'wss://base-mainnet.g.alchemy.com/v2/YOUR_KEY' },
  { label: 'QuickNode (template)', url: 'wss://xxx.base-mainnet.quiknode.pro/YOUR_KEY' },
]

export function ConfigScreen() {
  const { rpcUrl, setRpcUrl, connect, connecting, connError } = useStore()
  const [url, setUrl] = useState(rpcUrl)

  const handleConnect = () => {
    setRpcUrl(url.trim())
    connect()
  }

  return (
    <div className="config-wrap">
      <div className="config-card">
        <div className="config-title">Watch Token Flows</div>

        <p className="config-desc">
          Streams live block data from Base via WebSocket JSON-RPC.<br />
          Provides real-time visibility into transactions, token flows,<br />
          DEX swaps, lending activity, and full call traces.
        </p>

        <div className="config-field">
          <label className="config-label">WebSocket RPC Endpoint (Base mainnet)</label>
          <input
            className="config-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="wss://..."
            onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
          />
        </div>

        <div className="config-presets">
          <div className="config-preset-label">Quick presets:</div>
          <div className="config-preset-btns">
            {PRESETS.map((p) => (
              <button
                key={p.url}
                className="config-preset-btn"
                onClick={() => setUrl(p.url)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {connError && (
          <div className="config-error">
            Connection error: {connError}
          </div>
        )}

        <button
          className="config-btn"
          onClick={handleConnect}
          disabled={connecting || !url.trim()}
        >
          {connecting ? 'Connecting…' : 'Connect & Start Streaming'}
        </button>

        <p className="config-desc" style={{ fontSize: 10, color: 'var(--text3)' }}>
          Note: <code>debug_traceTransaction</code> must be available for tx traces.
          Alchemy/QuickNode nodes support this; public nodes may not.<br />
          No data is persisted — everything lives in browser memory.
        </p>
      </div>
    </div>
  )
}
