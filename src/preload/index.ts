import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  Account,
  AlpacaCredentials,
  ArmLiveInput,
  ArmLiveResult,
  Bar,
  BarUpdate,
  ConnectionStatus,
  FlattenResult,
  Keymap,
  LayoutsState,
  LiveState,
  Order,
  OrderRequest,
  PanelKind,
  PortfoliosState,
  Position,
  Quote,
  RiskDecision,
  RiskState,
  Snapshot,
  SaveSettingsInput,
  SettingsInfo,
  TestConnectionResult,
  Timeframe,
  TradingModeInfo,
  Trade,
  WatchlistsState
} from '@shared/types'

/** Subscribe to a main→renderer push channel; returns an unsubscribe fn. */
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

/**
 * The typed API surface exposed to the renderer. Everything is backed by an
 * ipcMain handler — the renderer never touches Node, the filesystem, or a
 * broker SDK directly.
 */
const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  getTradingMode: (): Promise<TradingModeInfo> => ipcRenderer.invoke('app:getTradingMode'),

  data: {
    getBars: (symbol: string, timeframe: Timeframe, limit: number): Promise<Bar[]> =>
      ipcRenderer.invoke('data:getBars', symbol, timeframe, limit),
    snapshots: (symbols: string[]): Promise<Snapshot[]> =>
      ipcRenderer.invoke('data:snapshots', symbols),
    subscribe: (symbols: string[]): Promise<void> => ipcRenderer.invoke('data:subscribe', symbols),
    unsubscribe: (symbols: string[]): Promise<void> =>
      ipcRenderer.invoke('data:unsubscribe', symbols),
    onQuote: (cb: (q: Quote) => void): (() => void) => on<Quote>('stream:quote', cb),
    onBar: (cb: (b: BarUpdate) => void): (() => void) => on<BarUpdate>('stream:bar', cb),
    onTrade: (cb: (t: Trade) => void): (() => void) => on<Trade>('stream:trade', cb)
  },

  account: {
    get: (): Promise<Account> => ipcRenderer.invoke('account:get'),
    onUpdate: (cb: (a: Account) => void): (() => void) => on<Account>('stream:account', cb)
  },

  positions: {
    get: (): Promise<Position[]> => ipcRenderer.invoke('positions:get'),
    onUpdate: (cb: (p: Position[]) => void): (() => void) => on<Position[]>('stream:positions', cb)
  },

  orders: {
    get: (): Promise<Order[]> => ipcRenderer.invoke('orders:get'),
    submit: (req: OrderRequest): Promise<RiskDecision> => ipcRenderer.invoke('orders:submit', req),
    cancel: (orderId: string): Promise<void> => ipcRenderer.invoke('orders:cancel', orderId),
    onUpdate: (cb: (o: Order) => void): (() => void) => on<Order>('stream:order', cb)
  },

  risk: {
    getState: (): Promise<RiskState> => ipcRenderer.invoke('risk:getState'),
    setKillSwitch: (on: boolean): Promise<RiskState> =>
      ipcRenderer.invoke('risk:setKillSwitch', on),
    flattenAll: (): Promise<FlattenResult> => ipcRenderer.invoke('risk:flattenAll'),
    onUpdate: (cb: (s: RiskState) => void): (() => void) => on<RiskState>('stream:risk', cb)
  },

  watchlists: {
    get: (): Promise<WatchlistsState> => ipcRenderer.invoke('watchlists:get'),
    set: (state: WatchlistsState): Promise<WatchlistsState> =>
      ipcRenderer.invoke('watchlists:set', state)
  },

  portfolios: {
    get: (): Promise<PortfoliosState> => ipcRenderer.invoke('portfolios:get'),
    save: (state: PortfoliosState): Promise<PortfoliosState> =>
      ipcRenderer.invoke('portfolios:save', state),
    setActive: (id: string): Promise<PortfoliosState> =>
      ipcRenderer.invoke('portfolios:setActive', id)
  },

  status: {
    get: (): Promise<ConnectionStatus> => ipcRenderer.invoke('status:get'),
    onUpdate: (cb: (s: ConnectionStatus) => void): (() => void) =>
      on<ConnectionStatus>('stream:status', cb)
  },

  settings: {
    get: (): Promise<SettingsInfo> => ipcRenderer.invoke('settings:get'),
    save: (input: SaveSettingsInput): Promise<SettingsInfo> =>
      ipcRenderer.invoke('settings:save', input),
    testConnection: (creds?: AlpacaCredentials): Promise<TestConnectionResult> =>
      ipcRenderer.invoke('settings:testConnection', creds)
  },

  windows: {
    open: (panel: PanelKind, params?: Record<string, string>): Promise<void> =>
      ipcRenderer.invoke('windows:open', panel, params ?? {})
  },

  hotkeys: {
    get: (): Promise<Keymap> => ipcRenderer.invoke('hotkeys:get'),
    save: (keymap: Keymap): Promise<Keymap> => ipcRenderer.invoke('hotkeys:save', keymap)
  },

  layouts: {
    get: (): Promise<LayoutsState> => ipcRenderer.invoke('layouts:get'),
    save: (state: LayoutsState): Promise<LayoutsState> => ipcRenderer.invoke('layouts:save', state)
  },

  onboarding: {
    get: (): Promise<boolean> => ipcRenderer.invoke('onboarding:get'),
    complete: (): Promise<boolean> => ipcRenderer.invoke('onboarding:complete')
  },

  live: {
    getState: (): Promise<LiveState> => ipcRenderer.invoke('live:getState'),
    arm: (input: ArmLiveInput): Promise<ArmLiveResult> => ipcRenderer.invoke('live:arm', input),
    disarm: (): Promise<LiveState> => ipcRenderer.invoke('live:disarm'),
    onUpdate: (cb: (s: LiveState) => void): (() => void) => on<LiveState>('stream:live', cb)
  }
}

export type Api = typeof api

// contextIsolation is always enabled in webPreferences, so the contextBridge is
// always the correct path. (Relying on `process.contextIsolated` is unreliable
// under `sandbox: true` — it can be undefined, silently skipping exposure.)
try {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error('Failed to expose preload API:', error)
}
