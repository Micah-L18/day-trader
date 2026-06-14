import { useCallback, useEffect, useRef, type ReactElement } from 'react'
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
import { TIMEFRAME_MS, type Bar, type Timeframe } from '@shared/types'
import { macd } from '@shared/indicators/macd'
import { useMarketStore } from '@renderer/state/marketStore'

const HISTORY = 200
const toTime = (ms: number): UTCTimestamp => Math.floor(ms / 1000) as UTCTimestamp
const UP = '#00c805'
const DOWN = '#ff5000'

/**
 * Candles (pane 0) + Volume (pane 1) + MACD(12,26,9) (pane 2) at the given
 * interval. History comes from getBars; live ticks are aggregated into the
 * current interval's forming bar so the chart moves at any timeframe.
 */
export function LightweightChart({
  symbol,
  interval
}: {
  symbol: string | null
  interval: Timeframe
}): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const macdRef = useRef<ISeriesApi<'Line'> | null>(null)
  const signalRef = useRef<ISeriesApi<'Line'> | null>(null)
  const histRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const barsRef = useRef<Bar[]>([])

  const quote = useMarketStore((s) => (symbol ? s.quotes[symbol] : undefined))

  const redraw = useCallback((fit: boolean): void => {
    const chart = chartRef.current
    const candle = candleRef.current
    const volume = volumeRef.current
    const macdLine = macdRef.current
    const signalLine = signalRef.current
    const histogram = histRef.current
    if (!chart || !candle || !volume || !macdLine || !signalLine || !histogram) return

    const bars = barsRef.current
    if (bars.length === 0) {
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
    if (fit) chart.timeScale().fitContent()
  }, [])

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

      while (chart.panes().length < 3) chart.addPane()

      const candle = chart.addSeries(
        CandlestickSeries,
        { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false },
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
    } catch (err) {
      console.error('LightweightChart init failed:', err)
    }

    return () => {
      chart?.remove()
      chartRef.current = null
    }
  }, [])

  // Load history whenever symbol or interval changes.
  useEffect(() => {
    barsRef.current = []
    redraw(true)
    if (!symbol) return
    let cancelled = false
    void window.api.data.getBars(symbol, interval, HISTORY).then((h) => {
      if (cancelled) return
      barsRef.current = h
      redraw(true)
    })
    return () => {
      cancelled = true
    }
  }, [symbol, interval, redraw])

  // Aggregate live ticks into the current interval's forming bar.
  useEffect(() => {
    if (!quote || !symbol) return
    const price = quote.last ?? quote.bid
    const tfMs = TIMEFRAME_MS[interval]
    const bucket = Math.floor((quote.time || Date.now()) / tfMs) * tfMs
    const bars = barsRef.current
    const last = bars[bars.length - 1]

    if (last && last.time === bucket) {
      last.high = Math.max(last.high, price)
      last.low = Math.min(last.low, price)
      last.close = price
    } else if (!last || bucket > last.time) {
      bars.push({ symbol, time: bucket, open: price, high: price, low: price, close: price, volume: 0 })
      if (bars.length > 500) bars.shift()
    } else {
      return
    }
    redraw(false)
  }, [quote, symbol, interval, redraw])

  return <div ref={containerRef} className="chart__container" />
}
