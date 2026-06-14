import { useState, type ReactElement } from 'react'
import { INDICATOR_ITEMS, type IndicatorConfig } from '@shared/types'

export function IndicatorsMenu({
  indicators,
  onToggle
}: {
  indicators: IndicatorConfig
  onToggle: (k: keyof IndicatorConfig) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div className="indmenu">
      <span className="tool" onClick={() => setOpen((o) => !o)}>
        ＋ Indicators
      </span>
      {open && (
        <>
          <div className="indmenu__backdrop" onClick={() => setOpen(false)} />
          <div className="indmenu__pop">
            {INDICATOR_ITEMS.map(({ key, label }) => (
              <label key={key} className="indmenu__row">
                <input type="checkbox" checked={indicators[key]} onChange={() => onToggle(key)} />
                {label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
