import { useEffect, useRef, type ReactElement } from 'react'
import {
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp
} from 'lightweight-charts'
import { macd } from '@shared/indicators/macd'
import { useMarketStore } from '@renderer/state/marketStore'

const HISTORY = 150

const toTime = (ms: number): UTCTimestamp => (Math.floor(ms / 1000) as UTCTimestamp)
const UP = '#00c805'
const DOWN = '#ff5000'

/**
 * The Legend-style chart: candlesticks (pane 0), a Volume histogram (pane 1),
 * and a computed MACD(12,26,9) — line, signal, histogram (pane 2). History
 * comes from `getBars`; live updates ride the same `bars` store slice the
 * stream bridge keeps current.
 */
export function LightweightChart({ symbol }: { symbol: string | null }): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const macdRef = useRef<ISeriesApi<'Line'> | null>(null)
  const signalRef = useRef<ISeriesApi<'Line'> | null>(null)
  const histRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const fitRef = useRef(false)

  const bars = useMarketStore((s) => (symbol ? s.bars[symbol] : undefined))

  // Build the chart + panes once.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let chart: IChartApi | null = null
    try {
      chart = createChart(container, {
        autoSize: true,
        layout: {
          background: { color: 'transparent' },
          textColor: '#8b97a6',
          fontSize: 11,
          panes: { separatorColor: '#1e2630', separatorHoverColor: '#2a3441', enableResize: true }
        },
        grid: {
          vertLines: { color: 'rgba(30,38,48,0.5)' },
          horzLines: { color: 'rgba(30,38,48,0.5)' }
        },
        rightPriceScale: { borderColor: '#1e2630' },
        timeScale: { borderColor: '#1e2630', timeVisible: true, secondsVisible: false },
        crosshair: { mode: CrosshairMode.Normal }
      })

      // Ensure the volume (1) and MACD (2) panes exist before adding series to
      // them — some builds don't auto-create panes from a paneIndex argument.
      while (chart.panes().length < 3) chart.addPane()

      const candle = chart.addSeries(
        CandlestickSeries,
        {
          upColor: UP,
          downColor: DOWN,
          wickUpColor: UP,
          wickDownColor: DOWN,
          borderVisible: false
        },
        0
      )
      const volume = chart.addSeries(
        HistogramSeries,
        { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
        1
      )
      const histogram = chart.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        2
      )
      const macdLine = chart.addSeries(
        LineSeries,
        { color: '#2f81f7', lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
        2
      )
      const signalLine = chart.addSeries(
        LineSeries,
        { color: '#f0a020', lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
        2
      )

      const panes = chart.panes()
      panes[0]?.setStretchFactor(6)
      panes[1]?.setStretchFactor(1.4)
      panes[2]?.setStretchFactor(2.4)

      chartRef.current = chart
      candleRef.current = candle
      volumeRef.current = volume
      macdRef.current = macdLine
      signalRef.current = signalLine
      histRef.current = histogram
      fitRef.current = true
    } catch (err) {
      console.error('LightweightChart init failed:', err)
    }

    return () => {
      chart?.remove()
      chartRef.current = null
    }
  }, [])

  // Load history when the symbol changes (live updates flow via the store).
  useEffect(() => {
    if (!symbol) return
    fitRef.current = true
    void window.api.data
      .getBars(symbol, '1Min', HISTORY)
      .then((h) => useMarketStore.getState().setBars(symbol, h))
  }, [symbol])

  // Render the current bars (history + live) into every series.
  useEffect(() => {
    const candle = candleRef.current
    const volume = volumeRef.current
    const macdLine = macdRef.current
    const signalLine = signalRef.current
    const histogram = histRef.current
    const chart = chartRef.current
    if (!candle || !volume || !macdLine || !signalLine || !histogram || !chart) return

    if (!bars || bars.length === 0) {
      candle.setData([])
      volume.setData([])
      macdLine.setData([])
      signalLine.setData([])
      histogram.setData([])
      return
    }

    const candleData: CandlestickData[] = []
    const volumeData: HistogramData[] = []
    for (const b of bars) {
      const time = toTime(b.time)
      candleData.push({ time, open: b.open, high: b.high, low: b.low, close: b.close })
      volumeData.push({
        time,
        value: b.volume,
        color: b.close >= b.open ? 'rgba(0,200,5,0.5)' : 'rgba(255,80,0,0.5)'
      })
    }

    const macdData = macd(bars.map((b) => b.close))
    const macdLineData: LineData[] = []
    const signalLineData: LineData[] = []
    const histData: HistogramData[] = []
    for (let i = 0; i < bars.length; i++) {
      const time = toTime(bars[i].time)
      const m = macdData[i]
      if (m.macd != null) macdLineData.push({ time, value: m.macd })
      if (m.signal != null) signalLineData.push({ time, value: m.signal })
      if (m.histogram != null)
        histData.push({
          time,
          value: m.histogram,
          color: m.histogram >= 0 ? 'rgba(0,200,5,0.55)' : 'rgba(255,80,0,0.55)'
        })
    }

    candle.setData(candleData)
    volume.setData(volumeData)
    macdLine.setData(macdLineData)
    signalLine.setData(signalLineData)
    histogram.setData(histData)

    if (fitRef.current) {
      chart.timeScale().fitContent()
      fitRef.current = false
    }
  }, [bars])

  return <div ref={containerRef} className="chart__container" />
}
