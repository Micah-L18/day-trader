import { type ReactElement } from 'react'
import { CHART_INTERVALS, CHART_RANGES, type RangeKey, type Timeframe } from '@shared/types'

/** Chart control strip: history ranges (left), bar interval (middle), auto-scale (right). */
export function IntervalBar({
  range,
  onRange,
  value,
  onChange,
  autoScale,
  onToggleAutoScale
}: {
  range: RangeKey
  onRange: (r: RangeKey) => void
  value: Timeframe
  onChange: (tf: Timeframe) => void
  autoScale: boolean
  onToggleAutoScale: () => void
}): ReactElement {
  return (
    <div className="chart__intervals">
      {CHART_RANGES.map(({ key }) => (
        <button
          key={key}
          className={`range ${range === key ? 'range--active' : ''}`}
          onClick={() => onRange(key)}
        >
          {key}
        </button>
      ))}
      <span className="sep" />
      {CHART_INTERVALS.map(({ tf, label }) => (
        <button
          key={tf}
          className={`range range--mini ${value === tf ? 'range--active' : ''}`}
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
        ⤢ Auto
      </button>
    </div>
  )
}
