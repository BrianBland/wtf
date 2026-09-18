import { Deployment } from '../types'
import { HexTag } from './HexTag'

/** Receipt/event-backed deployments. Deliberately hook-free: event metadata is final. */
export function DeploymentList({ deployments }: { deployments: Deployment[] }) {
  if (deployments.length === 0) return null

  return (
    <div className="flow-table" style={{ gap: 4 }}>
      {deployments.map((deployment) => (
        <div key={deployment.address} className="flex-center gap4 flow-row" style={{ flexWrap: 'wrap' }}>
          {deployment.kind === 'contract' ? (
            <>
              <span className="badge muted">Contract Created</span>
              <HexTag value={deployment.address} type="address" />
              <span className="muted" style={{ fontSize: 9 }}>receipt</span>
            </>
          ) : (
            <>
              <span className="badge muted">
                {deployment.variant === 'asset' ? 'B20 Asset' : 'B20 Stablecoin'} Created
              </span>
              <HexTag
                value={deployment.address}
                type="address"
                label={deployment.symbol}
                title={`${deployment.name} (${deployment.symbol}) · ${deployment.decimals} decimals`}
              />
              <span style={{ fontWeight: 600 }}>{deployment.name}</span>
              <span className="muted" style={{ fontSize: 9 }}>
                {deployment.symbol} · {deployment.decimals} decimals · B20 factory event
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
