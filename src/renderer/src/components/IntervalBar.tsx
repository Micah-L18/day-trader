import { type ReactElement } from 'react'
import { CHART_INTERVALS, type Timeframe } from '@shared/types'

export function IntervalBar({
  value,
  onChange,
  autoScale,
  onToggleAutoScale
}: {
  value: Timeframe
  onChange: (tf: Timeframe) => void
  autoScale: boolean
  onToggleAutoScale: () => void
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
      <span className="spacer" />
      <button
        className={`range ${autoScale ? 'range--active' : ''}`}
        onClick={onToggleAutoScale}
        title="Automatically fit the chart to the data"
      >
        ⤢ Auto-scale
      </button>
    </div>
  )
}
