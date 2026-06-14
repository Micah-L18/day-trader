import { BrowserWindow, net, protocol } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'

const SCHEME = 'app'
const HOST = 'bundle'

// The renderer is fully IPC-based (no direct network), so connect-src stays
// 'self'. Inline styles are needed for React/Lightweight-Charts.
const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'self'"

/** Register the privileged app scheme. Must run before `app` is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

/**
 * In production, serve the built renderer over app://bundle/ — a real, secure
 * origin so CSP `'self'` and module scripts work cleanly (unlike file://) — and
 * attach a strict CSP. In dev the Vite dev server handles loading; no CSP is
 * imposed so HMR is unaffected.
 */
export function setupRendererProtocol(): void {
  if (is.dev) return

  const root = join(__dirname, '../renderer')
  protocol.handle(SCHEME, async (request) => {
    const { pathname } = new URL(request.url)
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
    const filePath = join(root, rel)
    if (!filePath.startsWith(root)) return new Response('forbidden', { status: 403 })

    const res = await net.fetch(pathToFileURL(filePath).toString())
    const headers = new Headers(res.headers)
    headers.set('Content-Security-Policy', PROD_CSP)
    return new Response(res.body, { status: res.status, headers })
  })
}

/** Load the renderer into a window (dev server vs. app:// in production). */
export function loadRenderer(win: BrowserWindow, query: Record<string, string> = {}): void {
  const qs = Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : ''
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${qs}`)
  } else {
    void win.loadURL(`${SCHEME}://${HOST}/index.html${qs}`)
  }
}
