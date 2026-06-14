import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react'
import { useMarketStore, changePct } from '@renderer/state/marketStore'
import { useWatchlistStore } from '@renderer/state/watchlistStore'
import { PopOutButton } from '@renderer/components/PopOutButton'
import { pct, usd } from '@renderer/lib/format'

export function Watchlist(): ReactElement {
  const lists = useWatchlistStore((s) => s.lists)
  const activeId = useWatchlistStore((s) => s.activeId)
  const selected = useWatchlistStore((s) => s.selected)
  const loaded = useWatchlistStore((s) => s.loaded)
  const quotes = useMarketStore((s) => s.quotes)
  const opens = useMarketStore((s) => s.opens)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!loaded) void useWatchlistStore.getState().load()
  }, [loaded])

  const symbols = lists.find((l) => l.id === activeId)?.symbols ?? []
  const st = (): ReturnType<typeof useWatchlistStore.getState> => useWatchlistStore.getState()

  const onAddKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      st().addSymbol(query)
      setQuery('')
    }
  }

  return (
    <section className="rail-section">
      <div className="rail-section__title">
        {editing ? (
          <input
            className="field field--sm"
            autoFocus
            defaultValue={lists.find((l) => l.id === activeId)?.name}
            onBlur={(e) => {
              st().renameList(activeId, e.target.value.trim() || 'List')
              setEditing(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <select
            className="wl-select"
            value={activeId}
            onChange={(e) => st().setActive(e.target.value)}
          >
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <span className="wl-actions">
          <button className="popout-btn" onClick={() => setEditing(true)} title="Rename list">
            ✎
          </button>
          <button className="popout-btn" onClick={() => st().addList()} title="New list">
            ＋
          </button>
          {lists.length > 1 && (
            <button className="popout-btn" onClick={() => st().removeList(activeId)} title="Delete list">
              🗑
            </button>
          )}
          <PopOutButton panel="watchlist" />
        </span>
      </div>

      <input
        id="symbol-search-input"
        className="field field--sm wl-search"
        placeholder="Add symbol (e.g. AAPL)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onAddKey}
        autoComplete="off"
        spellCheck={false}
      />

      <div className="watchlist">
        {symbols.length === 0 && <div className="empty">Empty — add a symbol above.</div>}
        {symbols.map((sym) => {
          const q = quotes[sym]
          const last = q ? q.last ?? q.bid : undefined
          const chg = changePct(quotes, opens, sym)
          const up = chg >= 0
          return (
            <div key={sym} className={`wl-row ${sym === selected ? 'wl-row--active' : ''}`}>
              <button className="wl-main" onClick={() => st().select(sym)}>
                <span className="wl-sym">{sym}</span>
                <span className="wl-last">{last != null ? usd(last) : '—'}</span>
                <span className={`wl-chg ${up ? 'up' : 'down'}`}>{q ? pct(chg) : '—'}</span>
              </button>
              <button className="wl-remove" onClick={() => st().removeSymbol(sym)} title="Remove">
                ×
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
