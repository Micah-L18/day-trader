import { type ReactElement } from 'react'
import type { OrderStatus } from '@shared/types'
import { useAccountStore } from '@renderer/state/accountStore'
import { PopOutButton } from '@renderer/components/PopOutButton'
import { usd } from '@renderer/lib/format'

const OPEN: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'new',
  'accepted',
  'partially_filled',
  'pending'
])

export function Orders(): ReactElement {
  const orders = useAccountStore((s) => s.orders)

  return (
    <section className="rail-section">
      <div className="rail-section__title">
        Recent orders
        <PopOutButton panel="orders" />
      </div>
      {orders.length === 0 ? (
        <div className="empty">No orders.</div>
      ) : (
        <table className="postable">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Side</th>
              <th>Qty</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orders.slice(0, 12).map((o) => (
              <tr key={o.id}>
                <td className="postable__sym">{o.symbol}</td>
                <td className={o.side === 'buy' ? 'up' : 'down'}>{o.side}</td>
                <td>{o.qty}</td>
                <td>
                  {o.status}
                  {o.avgFillPrice != null ? ` @ ${usd(o.avgFillPrice)}` : ''}
                </td>
                <td>
                  {OPEN.has(o.status) ? (
                    <button className="link-btn" onClick={() => void window.api.orders.cancel(o.id)}>
                      cancel
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
