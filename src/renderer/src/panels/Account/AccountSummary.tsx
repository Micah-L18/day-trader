import { type ReactElement } from 'react'
import { useAccountStore } from '@renderer/state/accountStore'
import { usePortfolioStore } from '@renderer/state/portfolioStore'
import { usd } from '@renderer/lib/format'

export function AccountSummary(): ReactElement {
  const account = useAccountStore((s) => s.account)
  const portfolios = usePortfolioStore((s) => s.portfolios)
  const activeId = usePortfolioStore((s) => s.activeId)
  const name = portfolios.find((p) => p.id === activeId)?.name ?? 'Account'

  return (
    <section className="rail-section">
      <div className="rail-section__head">
        <span>{name}</span>
        <button className="btn btn--pill">Deposit</button>
      </div>
      <div className="account-value">{usd(account?.equity)}</div>
      <div className="account-change up">
        {account?.accountNumber ? `Acct ${account.accountNumber}` : 'Paper account'}
      </div>
      <div className="kv" style={{ marginTop: 10 }}>
        <span>Buying power</span>
        <span>{usd(account?.buyingPower)}</span>
      </div>
      <div className="kv">
        <span>Cash</span>
        <span>{usd(account?.cash)}</span>
      </div>
    </section>
  )
}
