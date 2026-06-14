import { useState, type ReactElement } from 'react'
import { WIDGET_LABELS, type WidgetType } from '@shared/types'
import { useLayoutStore } from '@renderer/state/layoutStore'

const TYPES: WidgetType[] = ['chart', 'watchlist', 'positions', 'orders', 'account']

export function AddWidgetMenu(): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div className="indmenu">
      <button className="btn btn--ghost" onClick={() => setOpen((o) => !o)}>
        ＋ Widget
      </button>
      {open && (
        <>
          <div className="indmenu__backdrop" onClick={() => setOpen(false)} />
          <div className="indmenu__pop indmenu__pop--left">
            {TYPES.map((t) => (
              <button
                key={t}
                className="indmenu__row"
                onClick={() => {
                  useLayoutStore.getState().addWidget(t)
                  setOpen(false)
                }}
              >
                {WIDGET_LABELS[t]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
