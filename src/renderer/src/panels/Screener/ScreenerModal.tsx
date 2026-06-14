import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { SCREENER_UNIVERSE, type Snapshot } from '@shared/types'
import { useSystemStore } from '@renderer/state/systemStore'
import { useWatchlistStore } from '@renderer/state/watchlistStore'
import { num, pct, usd } from '@renderer/lib/format'

type SortKey = 'changePct' | 'price' | 'volume'

export function ScreenerModal(): ReactElement | null {
  const open = useSystemStore((s) => s.screenerOpen)
  const close = useSystemStore((s) => s.closeScreener)

  const [snaps, setSnaps] = useState<Snapshot[]>([])
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [minChg, setMinChg] = useState('')
  const [minVol, setMinVol] = useState('')
  const [sort, setSort] = useState<SortKey>('changePct')

  useEffect(() => {
    if (!open) return
    let alive = true
    const refresh = (): void => {
      void window.api.data.snapshots([...SCREENER_UNIVERSE]).then((s) => {
        if (alive) setSnaps(s)
      })
    }
    refresh()
    const t = setInterval(refresh, 4000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [open])

  const results = useMemo(() => {
    const lo = minPrice ? Number(minPrice) : -Infinity
    const hi = maxPrice ? Number(maxPrice) : Infinity
    const chg = minChg ? Number(minChg) : 0
    const vol = minVol ? Number(minVol) : 0
    return snaps
      .filter(
        (s) =>
          s.price >= lo && s.price <= hi && Math.abs(s.changePct) >= chg && s.volume >= vol
      )
      .sort((a, b) =>
        sort === 'price' ? b.price - a.price : sort === 'volume' ? b.volume - a.volume : b.changePct - a.changePct
      )
  }, [snaps, minPrice, maxPrice, minChg, minVol, sort])

  if (!open) return null

  const pick = (sym: string): void => {
    useWatchlistStore.getState().select(sym)
    void window.api.data.subscribe([sym])
    close()
  }
  const addToList = (sym: string): void => useWatchlistStore.getState().addSymbol(sym)

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Screener</h2>
          <button className="modal__close" onClick={close}>
            ✕
          </button>
        </div>

        <div className="modal__section screener__filters">
          <label>
            Min $
            <input className="field field--sm" type="number" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
          </label>
          <label>
            Max $
            <input className="field field--sm" type="number" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
          </label>
          <label>
            Min |% chg|
            <input className="field field--sm" type="number" value={minChg} onChange={(e) => setMinChg(e.target.value)} />
          </label>
          <label>
            Min volume
            <input className="field field--sm" type="number" value={minVol} onChange={(e) => setMinVol(e.target.value)} />
          </label>
          <label>
            Sort
            <select className="field field--sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="changePct">% change</option>
              <option value="price">Price</option>
              <option value="volume">Volume</option>
            </select>
          </label>
        </div>

        <div className="screener__results">
          <table className="postable">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Price</th>
                <th>% chg</th>
                <th>Volume</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {results.map((s) => (
                <tr key={s.symbol}>
                  <td className="postable__sym">
                    <button className="link-btn" onClick={() => pick(s.symbol)}>
                      {s.symbol}
                    </button>
                  </td>
                  <td>{usd(s.price)}</td>
                  <td className={s.changePct >= 0 ? 'up' : 'down'}>{pct(s.changePct)}</td>
                  <td>{num(s.volume)}</td>
                  <td>
                    <button className="link-btn" onClick={() => addToList(s.symbol)} title="Add to watchlist">
                      ＋
                    </button>
                  </td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    No matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
