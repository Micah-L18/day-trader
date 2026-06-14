// Generates build/icon.png (1024x1024) — a dark rounded tile with a rising
// green chart line. No dependencies: hand-rolled anti-aliased drawing + PNG
// encoding. Run with `node scripts/generate-icon.mjs`.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const W = 1024
const H = 1024
const px = Buffer.alloc(W * H * 4) // RGBA, 0 = transparent

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

function blend(x, y, r, g, b, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= W || y >= H) return
  const i = (y * W + x) * 4
  const ia = px[i + 3] / 255
  const oa = a + ia * (1 - a)
  if (oa <= 0) return
  px[i] = Math.round((r * a + px[i] * ia * (1 - a)) / oa)
  px[i + 1] = Math.round((g * a + px[i + 1] * ia * (1 - a)) / oa)
  px[i + 2] = Math.round((b * a + px[i + 2] * ia * (1 - a)) / oa)
  px[i + 3] = Math.round(oa * 255)
}

function sdRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const hx = (x1 - x0) / 2 - r
  const hy = (y1 - y0) / 2 - r
  const qx = Math.abs(x - cx) - hx
  const qy = Math.abs(y - cy) - hy
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

function fillRoundRect(x0, y0, x1, y1, rad, r, g, b) {
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++)
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const cov = clamp(0.5 - sdRoundRect(x + 0.5, y + 0.5, x0, y0, x1, y1, rad), 0, 1)
      if (cov > 0) blend(x, y, r, g, b, cov)
    }
}

function segDist(x, y, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1)
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
}

function drawPolyline(pts, width, r, g, b) {
  const hw = width / 2
  const minx = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])) - hw - 1))
  const maxx = Math.min(W, Math.ceil(Math.max(...pts.map((p) => p[0])) + hw + 1))
  const miny = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])) - hw - 1))
  const maxy = Math.min(H, Math.ceil(Math.max(...pts.map((p) => p[1])) + hw + 1))
  for (let y = miny; y < maxy; y++)
    for (let x = minx; x < maxx; x++) {
      let d = Infinity
      for (let i = 0; i < pts.length - 1; i++)
        d = Math.min(d, segDist(x + 0.5, y + 0.5, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]))
      const cov = clamp(hw + 0.5 - d, 0, 1)
      if (cov > 0) blend(x, y, r, g, b, cov)
    }
}

function fillCircle(cx, cy, rad, r, g, b) {
  for (let y = Math.floor(cy - rad - 1); y < Math.ceil(cy + rad + 1); y++)
    for (let x = Math.floor(cx - rad - 1); x < Math.ceil(cx + rad + 1); x++) {
      const cov = clamp(rad + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy), 0, 1)
      if (cov > 0) blend(x, y, r, g, b, cov)
    }
}

// --- Compose the icon ---
fillRoundRect(8, 8, W - 8, H - 8, 232, 0x12, 0x17, 0x1e) // dark rounded tile
const line = [
  [232, 712],
  [392, 548],
  [520, 632],
  [660, 408],
  [812, 300]
]
drawPolyline(line, 52, 0x00, 0xc8, 0x05) // rising green line
fillCircle(812, 300, 34, 0x00, 0xc8, 0x05) // node at the tip

// --- Encode PNG ---
const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const raw = Buffer.alloc(H * (W * 4 + 1))
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0 // no filter
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`Wrote ${out} (${png.length} bytes)`)
