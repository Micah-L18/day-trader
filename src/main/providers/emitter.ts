/**
 * A tiny strongly-typed event emitter. `Events` maps event name → payload type,
 * so `on`/`emit` are checked at compile time (no `any` across the boundary).
 */
type Listener<T> = (payload: T) => void

export class TypedEmitter<Events> {
  private listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {}

  on<K extends keyof Events>(event: K, cb: Listener<Events[K]>): () => void {
    const set = (this.listeners[event] ??= new Set<Listener<Events[K]>>())
    set.add(cb)
    return () => {
      this.listeners[event]?.delete(cb)
    }
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.listeners[event]?.forEach((l) => l(payload))
  }

  protected clearListeners(): void {
    this.listeners = {}
  }
}
