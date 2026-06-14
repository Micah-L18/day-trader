import { type ReactElement } from 'react'
import { useMarketStore, changePct } from '@renderer/state/marketStore'
import { useWatchlistStore } from '@renderer/state/watchlistStore'
import { PopOutButton } from '@renderer/components/PopOutButton'
import { pct, usd } from '@renderer/lib/format'

export function Watchlist(): ReactElement {
  const symbols = useWatchlistStore((s) => s.symbols)
  const selected = useWatchlistStore((s) => s.selected)
  const select = useWatchlistStore((s) => s.select)
  const quotes = useMarketStore((s) => s.quotes)
  const opens = useMarketStore((s) => s.opens)

  return (
    <section className="rail-section">
      <div className="rail-section__title">
        Watchlist
        <PopOutButton panel="watchlist" />
      </div>
      <div className="watchlist">
        {symbols.map((sym) => {
          const q = quotes[sym]
          const last = q ? q.last ?? q.bid : undefined
          const chg = changePct(quotes, opens, sym)
          const up = chg >= 0
          return (
            <button
              key={sym}
              className={`wl-row ${sym === selected ? 'wl-row--active' : ''}`}
              onClick={() => select(sym)}
            >
              <span className="wl-sym">{sym}</span>
              <span className="wl-last">{last != null ? usd(last) : '—'}</span>
              <span className={`wl-chg ${up ? 'up' : 'down'}`}>{q ? pct(chg) : '—'}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
