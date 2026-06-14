import { type ReactElement } from 'react'
import { CHART_INTERVALS, type Timeframe } from '@shared/types'

export function IntervalBar({
  value,
  onChange
}: {
  value: Timeframe
  onChange: (tf: Timeframe) => void
}): ReactElement {
  return (
    <div className="chart__intervals">
      {CHART_INTERVALS.map(({ tf, label }) => (
        <button
          key={tf}
          className={`range ${value === tf ? 'range--active' : ''}`}
          onClick={() => onChange(tf)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
