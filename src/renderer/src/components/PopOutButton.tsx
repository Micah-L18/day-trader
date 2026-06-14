import { type ReactElement } from 'react'
import type { PanelKind } from '@shared/types'

/** Opens the given panel in its own OS window (drag it to another monitor). */
export function PopOutButton({
  panel,
  symbol,
  title
}: {
  panel: PanelKind
  symbol?: string | null
  title?: string
}): ReactElement {
  const open = (): void => {
    void window.api.windows.open(panel, symbol ? { symbol } : {})
  }
  return (
    <button className="popout-btn" onClick={open} title={title ?? 'Pop out into its own window'}>
      ⧉
    </button>
  )
}
