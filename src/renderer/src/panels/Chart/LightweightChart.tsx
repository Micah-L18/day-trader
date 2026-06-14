import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import {
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp
} from 'lightweight-charts'
import {
  CHART_RANGES,
  TIMEFRAME_MS,
  type Bar,
  type IndicatorConfig,
  type RangeKey,
  type Timeframe
} from '@shared/types'
import { ema } from '@shared/indicators/ema'
import { sma } from '@shared/indicators/sma'
import { macd } from '@shared/indicators/macd'
import { rsi } from '@shared/indicators/rsi'
import { vwap } from '@shared/indicators/vwap'
import { bbands } from '@shared/indicators/bbands'
import { useMarketStore } from '@renderer/state/marketStore'
import { useDrawingStore } from '@renderer/state/drawingStore'

const toTime = (ms: number): UTCTimestamp => Math.floor(ms / 1000) as UTCTimestamp
const UP = '#00c805'
const DOWN = '#ff5000'

interface ChartSeries {
  candle: ISeriesApi<'Candlestick'>
  volume?: ISeriesApi<'Histogram'>
  macdLine?: ISeriesApi<'Line'>
  macdSignal?: ISeriesApi<'Line'>
  macdHist?: ISeriesApi<'Histogram'>
  rsi?: ISeriesApi<'Line'>
  ema20?: ISeriesApi<'Line'>
  ema50?: ISeriesApi<'Line'>
  sma20?: ISeriesApi<'Line'>
  vwap?: ISeriesApi<'Line'>
  bbU?: ISeriesApi<'Line'>
  bbM?: ISeriesApi<'Line'>
  bbL?: ISeriesApi<'Line'>
}

function historyBars(range: RangeKey, interval: Timeframe): number {
  const dur = CHART_RANGES.find((r) => r.key === range)?.durationMs ?? 86_400_000
  return Math.min(2000, Math.max(40, Math.ceil(dur / TIMEFRAME_MS[interval])))
}

const lineToData = (bars: Bar[], vals: (number | null)[], color: string): LineData[] => {
  const out: LineData[] = []
  for (let i = 0; i < bars.length; i++) if (vals[i] != null) out.push({ time: toTime(bars[i].time), value: vals[i] as number, color })
  return out
}

export function LightweightChart({
  symbol,
  interval,
  range,
  autoScale,
  indicators,
  drawMode
}: {
  symbol: string | null
  interval: Timeframe
  range: RangeKey
  autoScale: boolean
  indicators: IndicatorConfig
  drawMode: boolean
}): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ChartSeries | null>(null)
  const barsRef = useRef<Bar[]>([])
  const autoScaleRef = useRef(autoScale)
  const drawModeRef = useRef(drawMode)
  const symbolRef = useRef(symbol)
  const priceLinesRef = useRef<IPriceLine[]>([])
  const [chartTick, setChartTick] = useState(0)

  const quote = useMarketStore((s) => (symbol ? s.quotes[symbol] : undefined))
  const drawings = useDrawingStore((s) => (symbol ? s.bySymbol[symbol] : undefined))
  const indKey = JSON.stringify(indicators)

  const redraw = useCallback((fit: boolean): void => {
    const chart = chartRef.current
    const s = seriesRef.current
    if (!chart || !s) return
    const bars = barsRef.current

    const candleData: CandlestickData[] = bars.map((b) => ({
      time: toTime(b.time),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close
    }))
    s.candle.setData(candleData)

    const closes = bars.map((b) => b.close)

    if (s.volume)
      s.volume.setData(
        bars.map((b) => ({
          time: toTime(b.time),
          value: b.volume,
          color: b.close >= b.open ? 'rgba(0,200,5,0.5)' : 'rgba(255,80,0,0.5)'
        }))
      )

    if (s.ema20) s.ema20.setData(lineToData(bars, ema(closes, 20), '#f0a020'))
    if (s.ema50) s.ema50.setData(lineToData(bars, ema(closes, 50), '#2f81f7'))
    if (s.sma20) s.sma20.setData(lineToData(bars, sma(closes, 20), '#b07cf0'))
    if (s.vwap) s.vwap.setData(lineToData(bars, vwap(bars), '#00b3d6'))
    if (s.bbM) {
      const bb = bbands(closes)
      s.bbU?.setData(lineToData(bars, bb.map((x) => x.upper), 'rgba(150,150,170,0.7)'))
      s.bbM.setData(lineToData(bars, bb.map((x) => x.middle), 'rgba(150,150,170,0.45)'))
      s.bbL?.setData(lineToData(bars, bb.map((x) => x.lower), 'rgba(150,150,170,0.7)'))
    }

    if (s.macdLine && s.macdSignal && s.macdHist) {
      const m = macd(closes)
      s.macdLine.setData(lineToData(bars, m.map((x) => x.macd), '#2f81f7'))
      s.macdSignal.setData(lineToData(bars, m.map((x) => x.signal), '#f0a020'))
      const hist: HistogramData[] = []
      for (let i = 0; i < bars.length; i++)
        if (m[i].histogram != null)
          hist.push({
            time: toTime(bars[i].time),
            value: m[i].histogram as number,
            color: (m[i].histogram as number) >= 0 ? 'rgba(0,200,5,0.55)' : 'rgba(255,80,0,0.55)'
          })
      s.macdHist.setData(hist)
    }

    if (s.rsi) s.rsi.setData(lineToData(bars, rsi(closes), '#b07cf0'))

    if (fit) chart.timeScale().fitContent()
  }, [])

  // Build the chart + the series for the active indicators (rebuilds on toggle).
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
        grid: { vertLines: { color: 'rgba(30,38,48,0.5)' }, horzLines: { color: 'rgba(30,38,48,0.5)' } },
        rightPriceScale: { borderColor: '#1e2630' },
        timeScale: { borderColor: '#1e2630', timeVisible: true, secondsVisible: false },
        crosshair: { mode: CrosshairMode.Normal }
      })

      let pane = 1
      const volPane = indicators.volume ? pane++ : -1
      const macdPane = indicators.macd ? pane++ : -1
      const rsiPane = indicators.rsi ? pane++ : -1
      while (chart.panes().length < pane) chart.addPane()

      const lineOpts = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false }
      const overlay = (color: string): ISeriesApi<'Line'> =>
        chart!.addSeries(LineSeries, { color, ...lineOpts }, 0)

      const s: ChartSeries = {
        candle: chart.addSeries(
          CandlestickSeries,
          { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false },
          0
        )
      }
      if (indicators.ema20) s.ema20 = overlay('#f0a020')
      if (indicators.ema50) s.ema50 = overlay('#2f81f7')
      if (indicators.sma20) s.sma20 = overlay('#b07cf0')
      if (indicators.vwap) s.vwap = overlay('#00b3d6')
      if (indicators.bbands) {
        s.bbU = overlay('rgba(150,150,170,0.7)')
        s.bbM = overlay('rgba(150,150,170,0.45)')
        s.bbL = overlay('rgba(150,150,170,0.7)')
      }
      if (volPane >= 0)
        s.volume = chart.addSeries(
          HistogramSeries,
          { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
          volPane
        )
      if (macdPane >= 0) {
        s.macdHist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, macdPane)
        s.macdLine = chart.addSeries(LineSeries, { color: '#2f81f7', ...lineOpts }, macdPane)
        s.macdSignal = chart.addSeries(LineSeries, { color: '#f0a020', ...lineOpts }, macdPane)
      }
      if (rsiPane >= 0) s.rsi = chart.addSeries(LineSeries, { color: '#b07cf0', ...lineOpts }, rsiPane)

      const panes = chart.panes()
      panes[0]?.setStretchFactor(6)
      for (let i = 1; i < panes.length; i++) panes[i]?.setStretchFactor(1.8)

      chart.priceScale('right').applyOptions({ autoScale: autoScaleRef.current })
      chartRef.current = chart
      seriesRef.current = s
      chart.subscribeClick((param) => {
        if (!drawModeRef.current || !param.point) return
        const sym = symbolRef.current
        const price = sym ? seriesRef.current?.candle.coordinateToPrice(param.point.y) : null
        if (sym && price != null) useDrawingStore.getState().addLine(sym, price)
      })
      redraw(true)
      setChartTick((t) => t + 1)
    } catch (err) {
      console.error('LightweightChart init failed:', err)
    }

    return () => {
      priceLinesRef.current = []
      chart?.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [indKey, redraw])

  useEffect(() => {
    drawModeRef.current = drawMode
  }, [drawMode])
  useEffect(() => {
    symbolRef.current = symbol
  }, [symbol])

  // Render the symbol's horizontal lines on the candle series.
  useEffect(() => {
    const candle = seriesRef.current?.candle
    if (!candle) return
    for (const pl of priceLinesRef.current) {
      try {
        candle.removePriceLine(pl)
      } catch {
        /* line belonged to a removed series */
      }
    }
    priceLinesRef.current = (drawings ?? []).map((price) =>
      candle.createPriceLine({
        price,
        color: '#e6edf3',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true
      })
    )
  }, [symbol, drawings, chartTick])

  // Load history on symbol / interval / range change.
  useEffect(() => {
    barsRef.current = []
    redraw(true)
    if (!symbol) return
    let cancelled = false
    void window.api.data.getBars(symbol, interval, historyBars(range, interval)).then((h) => {
      if (cancelled) return
      barsRef.current = h
      redraw(true)
    })
    return () => {
      cancelled = true
    }
  }, [symbol, interval, range, redraw])

  // Auto-scale toggle.
  useEffect(() => {
    autoScaleRef.current = autoScale
    seriesRef.current?.candle.priceScale().applyOptions({ autoScale })
    if (autoScale) chartRef.current?.timeScale().fitContent()
  }, [autoScale])

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
      if (bars.length > 2200) bars.shift()
    } else {
      return
    }
    redraw(autoScaleRef.current)
  }, [quote, symbol, interval, redraw])

  return <div ref={containerRef} className="chart__container" />
}
