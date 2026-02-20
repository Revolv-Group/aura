/**
 * Sync Event Definitions
 *
 * Event types for the memory sync system.
 * Uses Node.js EventEmitter for internal event-driven sync.
 */

import { EventEmitter } from "events";

// ============================================================================
// EVENT TYPES
// ============================================================================

export type SyncEventType =
  | "memory:compacted"
  | "memory:entity_updated"
  | "task:completed"
  | "sync:reconcile"
  | "sync:connectivity_restored";

export interface SyncEvent {
  type: SyncEventType;
  entityId: string;
  entityType: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

// ============================================================================
// EVENT BUS
// ============================================================================

class SyncEventBus extends EventEmitter {
  private offlineBuffer: SyncEvent[] = [];
  private _isOnline: boolean = true;

  get isOnline(): boolean {
    return this._isOnline;
  }

  /**
   * Emit a sync event. If offline, buffer for later.
   */
  emitSync(event: SyncEvent): void {
    if (this._isOnline) {
      this.emit(event.type, event);
    } else {
      this.offlineBuffer.push(event);
    }
  }

  /**
   * Mark system as offline - events will be buffered
   */
  goOffline(): void {
    this._isOnline = false;
  }

  /**
   * Mark system as online and flush buffered events
   */
  goOnline(): void {
    this._isOnline = true;
    const buffered = [...this.offlineBuffer];
    this.offlineBuffer = [];

    if (buffered.length > 0) {
      this.emit("sync:connectivity_restored", {
        type: "sync:connectivity_restored",
        entityId: "",
        entityType: "",
        timestamp: Date.now(),
        payload: { bufferedCount: buffered.length },
      });

      // Replay buffered events
      for (const event of buffered) {
        this.emit(event.type, event);
      }
    }
  }

  /**
   * Get count of buffered offline events
   */
  getBufferedCount(): number {
    return this.offlineBuffer.length;
  }
}

// Singleton event bus
export const syncEventBus = new SyncEventBus();
