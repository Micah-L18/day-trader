import { type ReactElement } from 'react'
import type { Position } from '@shared/types'
import { useAccountStore } from '@renderer/state/accountStore'
import { PopOutButton } from '@renderer/components/PopOutButton'
import { signedUsd, usd } from '@renderer/lib/format'

export function Positions(): ReactElement {
  const positions = useAccountStore((s) => s.positions)

  const close = (p: Position): void => {
    void window.api.orders.submit({
      symbol: p.symbol,
      side: p.qty > 0 ? 'sell' : 'buy',
      qty: Math.abs(p.qty),
      type: 'market'
    })
  }

  return (
    <section className="rail-section rail-section--fill">
      <div className="rail-section__title">
        Positions
        <PopOutButton panel="positions" />
      </div>
      {positions.length === 0 ? (
        <div className="empty">No positions.</div>
      ) : (
        <table className="postable">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Qty</th>
              <th>Avg</th>
              <th>P&amp;L</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.symbol}>
                <td className="postable__sym">{p.symbol}</td>
                <td>{p.qty}</td>
                <td>{usd(p.avgPrice)}</td>
                <td className={p.unrealizedPnl >= 0 ? 'up' : 'down'}>{signedUsd(p.unrealizedPnl)}</td>
                <td>
                  <button className="link-btn" onClick={() => close(p)}>
                    close
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
