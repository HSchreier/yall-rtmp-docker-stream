// Frontend EventBus — Pub/Sub for component state synchronization
// Mimics backend architecture for consistency

type Listener<T = unknown> = (payload: T) => void;
type UnsubscribeFn = () => void;

export interface EventMap {
  'stream:started': { streamKey: string; at: Date };
  'stream:ended': { streamKey: string; at: Date; durationMs: number };
  'stream:status:changed': { status: 'offline' | 'live' | 'idle' };
  'ui:modal:open': { modal: string };
  'ui:modal:close': { modal: string };
  'auth:login': { userId: string; role: string };
  'auth:logout': {};
  'profile:activated': { userId: string };
  'destination:configured': { platform: string };
  'notification:show': { message: string; type: 'info' | 'success' | 'error' | 'warning' };
}

export class EventBus {
  private listeners = new Map<keyof EventMap, Set<Listener>>();

  on<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): UnsubscribeFn {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as Listener);

    return () => {
      this.listeners.get(event)?.delete(listener as Listener);
    };
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;

    listeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (err) {
        console.error(`EventBus listener error for ${String(event)}:`, err);
      }
    });
  }

  clear(event?: keyof EventMap): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}

// Singleton instance
export const eventBus = new EventBus();
