import { type ReactElement } from 'react'
import type { WidgetType } from '@shared/types'
import { activeWidgets, useLayoutStore } from '@renderer/state/layoutStore'
import { Widget } from '@renderer/components/Widget'

/** The widget workspace. Re-renders only when the set of widgets (ids/types)
 * changes; individual widgets handle their own move/resize. */
export function WidgetBoard(): ReactElement {
  const meta = useLayoutStore((s) => activeWidgets(s).map((w) => `${w.i}|${w.type}`).join(','))
  const items = meta
    ? meta.split(',').map((s) => {
        const [i, type] = s.split('|')
        return { i, type: type as WidgetType }
      })
    : []

  return (
    <div className="widgetboard">
      {items.length === 0 && (
        <div className="widgetboard__empty">No widgets — use “＋ Widget” to add some.</div>
      )}
      {items.map((w) => (
        <Widget key={w.i} id={w.i} type={w.type} />
      ))}
    </div>
  )
}
