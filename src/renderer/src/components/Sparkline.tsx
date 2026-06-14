import { useEffect, useRef, type ReactElement } from 'react'

interface SparklineProps {
  data: number[]
  up?: boolean
}

/**
 * A lightweight canvas line+area chart. Placeholder for the price pane until
 * Phase 2 swaps in TradingView Lightweight Charts — but it makes the live data
 * visible now. Redraws whenever `data` changes (every sim tick).
 */
export function Sparkline({ data, up = true }: SparklineProps): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return

    const dpr = window.devicePixelRatio || 1
    const w = parent.clientWidth
    const h = parent.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)
    if (data.length < 2) return

    const min = Math.min(...data)
    const max = Math.max(...data)
    const range = max - min || 1
    const pad = 10
    const plotW = w - pad * 2
    const plotH = h - pad * 2
    const x = (i: number): number => pad + (i / (data.length - 1)) * plotW
    const y = (v: number): number => pad + plotH - ((v - min) / range) * plotH

    const color = up ? '#00c805' : '#ff5000'

    // Area fill under the line.
    ctx.beginPath()
    ctx.moveTo(x(0), y(data[0]))
    for (let i = 1; i < data.length; i++) ctx.lineTo(x(i), y(data[i]))
    ctx.lineTo(x(data.length - 1), h - pad)
    ctx.lineTo(x(0), h - pad)
    ctx.closePath()
    const grad = ctx.createLinearGradient(0, pad, 0, h)
    grad.addColorStop(0, up ? 'rgba(0,200,5,0.22)' : 'rgba(255,80,0,0.22)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.fill()

    // Price line.
    ctx.beginPath()
    ctx.moveTo(x(0), y(data[0]))
    for (let i = 1; i < data.length; i++) ctx.lineTo(x(i), y(data[i]))
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Last-price dot.
    ctx.beginPath()
    ctx.arc(x(data.length - 1), y(data[data.length - 1]), 2.5, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  }, [data, up])

  return <canvas ref={ref} className="sparkline" />
}
