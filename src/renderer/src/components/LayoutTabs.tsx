import { useState, type ReactElement } from 'react'
import { useLayoutStore } from '@renderer/state/layoutStore'

/** Top-bar layout tabs: switch, add, rename (double-click), and delete. */
export function LayoutTabs(): ReactElement {
  const layouts = useLayoutStore((s) => s.layouts)
  const activeId = useLayoutStore((s) => s.activeId)
  const setActive = useLayoutStore((s) => s.setActive)
  const add = useLayoutStore((s) => s.add)
  const remove = useLayoutStore((s) => s.remove)
  const rename = useLayoutStore((s) => s.rename)
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <nav className="tabs">
      {layouts.map((l) => (
        <div
          key={l.id}
          className={`tab ${l.id === activeId ? 'tab--active' : ''}`}
          onClick={() => setActive(l.id)}
          onDoubleClick={() => setEditing(l.id)}
        >
          {editing === l.id ? (
            <input
              className="tab__edit"
              autoFocus
              defaultValue={l.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                rename(l.id, e.target.value.trim() || l.name)
                setEditing(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setEditing(null)
              }}
            />
          ) : (
            <>
              <span>{l.name}</span>
              {layouts.length > 1 && (
                <button
                  className="tab__close"
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(l.id)
                  }}
                  title="Delete layout"
                >
                  ×
                </button>
              )}
            </>
          )}
        </div>
      ))}
      <button className="tab tab--add" onClick={add} title="New layout">
        ＋
      </button>
    </nav>
  )
}
