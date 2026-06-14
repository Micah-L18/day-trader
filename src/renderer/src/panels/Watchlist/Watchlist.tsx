import { useState, type KeyboardEvent, type ReactElement } from 'react'
import { useMarketStore, changePct } from '@renderer/state/marketStore'
import { useWatchlistStore } from '@renderer/state/watchlistStore'
import { PopOutButton } from '@renderer/components/PopOutButton'
import { pct, usd } from '@renderer/lib/format'

export function Watchlist(): ReactElement {
  const symbols = useWatchlistStore((s) => s.symbols)
  const selected = useWatchlistStore((s) => s.selected)
  const select = useWatchlistStore((s) => s.select)
  const setSymbols = useWatchlistStore((s) => s.setSymbols)
  const quotes = useMarketStore((s) => s.quotes)
  const opens = useMarketStore((s) => s.opens)
  const [query, setQuery] = useState('')

  const add = async (): Promise<void> => {
    const sym = query.trim().toUpperCase()
    setQuery('')
    if (!sym) return
    if (symbols.includes(sym)) {
      select(sym)
      return
    }
    setSymbols(await window.api.watchlist.set([...symbols, sym]))
    select(sym)
  }

  const remove = async (sym: string): Promise<void> => {
    const saved = await window.api.watchlist.set(symbols.filter((s) => s !== sym))
    setSymbols(saved)
    if (selected === sym) select(saved[0] ?? '')
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') void add()
  }

  return (
    <section className="rail-section">
      <div className="rail-section__title">
        Watchlist
        <PopOutButton panel="watchlist" />
      </div>

      <input
        id="symbol-search-input"
        className="field field--sm wl-search"
        placeholder="Add symbol (e.g. AAPL)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
        autoComplete="off"
        spellCheck={false}
      />

      <div className="watchlist">
        {symbols.map((sym) => {
          const q = quotes[sym]
          const last = q ? q.last ?? q.bid : undefined
          const chg = changePct(quotes, opens, sym)
          const up = chg >= 0
          return (
            <div key={sym} className={`wl-row ${sym === selected ? 'wl-row--active' : ''}`}>
              <button className="wl-main" onClick={() => select(sym)}>
                <span className="wl-sym">{sym}</span>
                <span className="wl-last">{last != null ? usd(last) : '—'}</span>
                <span className={`wl-chg ${up ? 'up' : 'down'}`}>{q ? pct(chg) : '—'}</span>
              </button>
              <button className="wl-remove" onClick={() => void remove(sym)} title="Remove">
                ×
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
