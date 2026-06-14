import { useEffect, type ChangeEvent, type ReactElement } from 'react'
import { usePortfolioStore } from '@renderer/state/portfolioStore'

/** Top-bar account/portfolio switcher (+ create a new sim portfolio). */
export function AccountSelector(): ReactElement {
  const portfolios = usePortfolioStore((s) => s.portfolios)
  const activeId = usePortfolioStore((s) => s.activeId)
  const loaded = usePortfolioStore((s) => s.loaded)

  useEffect(() => {
    if (!loaded) void usePortfolioStore.getState().load()
  }, [loaded])

  const onChange = (e: ChangeEvent<HTMLSelectElement>): void => {
    const v = e.target.value
    if (v === '__new') {
      const n = portfolios.filter((p) => p.kind === 'sim').length + 1
      const cash = 25_000 + Math.round(Math.random() * 75_000)
      void usePortfolioStore.getState().addSim(`Sim ${n}`, cash)
    } else {
      void usePortfolioStore.getState().setActive(v)
    }
  }

  return (
    <select className="account-select" value={activeId} onChange={onChange} title="Active portfolio">
      {portfolios.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
      <option value="__new">＋ New sim portfolio</option>
    </select>
  )
}
