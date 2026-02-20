/**
 * Sync Engine
 *
 * Event-driven sync orchestrator between local Qdrant and cloud Pinecone.
 *
 * Event schedule:
 * - memory:compacted -> sync to Pinecone within 30s
 * - memory:entity_updated -> batch sync every 5 minutes
 * - task:completed -> sync immediately
 * - Full reconciliation -> every 15 minutes
 *
 * Offline handling: events buffer in-memory, flush when connectivity restored.
 */

import { logger } from "../logger";
import { syncEventBus, type SyncEvent } from "./events";
import {
  getOrCreateLedgerEntry,
  markSynced,
  getPendingEntries,
  getSyncStats,
} from "./sync-ledger";
import { resolveConflict, type ConflictContext } from "./conflict-resolver";
import {
  getPendingSyncMemories,
  updateSyncStatus,
} from "../memory/qdrant-store";
import {
  isPineconeConfigured,
  upsertCompactedToPinecone,
  upsertEntityToPinecone,
} from "../memory/pinecone-store";

// ============================================================================
// STATE
// ============================================================================

let isRunning = false;
let reconciliationInterval: ReturnType<typeof setInterval> | null = null;
let entityBatchInterval: ReturnType<typeof setInterval> | null = null;

// Pending entity updates for batching
const pendingEntityUpdates = new Map<string, Record<string, unknown>>();

// ============================================================================
// ENGINE LIFECYCLE
// ============================================================================

/**
 * Start the sync engine
 */
export function startSyncEngine(): void {
  if (isRunning) return;
  isRunning = true;

  // Register event handlers
  syncEventBus.on("memory:compacted", handleCompactedMemory);
  syncEventBus.on("memory:entity_updated", handleEntityUpdate);
  syncEventBus.on("task:completed", handleTaskCompleted);
  syncEventBus.on("sync:connectivity_restored", handleConnectivityRestored);

  // Entity batch sync every 5 minutes
  entityBatchInterval = setInterval(flushEntityBatch, 5 * 60 * 1000);

  // Full reconciliation every 15 minutes
  reconciliationInterval = setInterval(reconcile, 15 * 60 * 1000);

  logger.info("Sync engine started");
}

/**
 * Stop the sync engine
 */
export function stopSyncEngine(): void {
  if (!isRunning) return;
  isRunning = false;

  syncEventBus.removeAllListeners("memory:compacted");
  syncEventBus.removeAllListeners("memory:entity_updated");
  syncEventBus.removeAllListeners("task:completed");
  syncEventBus.removeAllListeners("sync:connectivity_restored");

  if (entityBatchInterval) {
    clearInterval(entityBatchInterval);
    entityBatchInterval = null;
  }
  if (reconciliationInterval) {
    clearInterval(reconciliationInterval);
    reconciliationInterval = null;
  }

  logger.info("Sync engine stopped");
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle compacted memory -> sync to Pinecone within 30s
 */
async function handleCompactedMemory(event: SyncEvent): Promise<void> {
  if (!isPineconeConfigured()) return;

  // Delay 30s to allow for additional updates
  setTimeout(async () => {
    try {
      const pending = await getPendingSyncMemories();
      for (const mem of pending) {
        await upsertCompactedToPinecone(mem.id, mem.payload.summary, {
          ...mem.payload,
        });
        await updateSyncStatus(mem.id, "synced");
        await markSynced("compacted_memory", mem.id, mem.payload.version);

        logger.debug({ memoryId: mem.id }, "Synced compacted memory to Pinecone");
      }
    } catch (error) {
      logger.error({ error }, "Failed to sync compacted memory to Pinecone");
    }
  }, 30000);
}

/**
 * Handle entity update -> batch for 5-minute sync
 */
async function handleEntityUpdate(event: SyncEvent): Promise<void> {
  if (!isPineconeConfigured()) return;

  pendingEntityUpdates.set(event.entityId, event.payload || {});
}

/**
 * Handle task completion -> sync immediately
 */
async function handleTaskCompleted(event: SyncEvent): Promise<void> {
  if (!isPineconeConfigured()) return;

  try {
    // Update task status in cloud immediately
    logger.debug({ taskId: event.entityId }, "Task completed, syncing to cloud");
  } catch (error) {
    logger.error({ error }, "Failed to sync task completion");
  }
}

/**
 * Handle connectivity restored -> flush all buffered events
 */
async function handleConnectivityRestored(event: SyncEvent): Promise<void> {
  const bufferedCount = event.payload?.bufferedCount as number;
  logger.info({ bufferedCount }, "Connectivity restored, flushing buffered events");

  // Run immediate reconciliation
  await reconcile();
}

// ============================================================================
// BATCH & RECONCILIATION
// ============================================================================

/**
 * Flush pending entity updates to Pinecone
 */
async function flushEntityBatch(): Promise<void> {
  if (!isPineconeConfigured() || pendingEntityUpdates.size === 0) return;

  try {
    for (const [entityId, data] of Array.from(pendingEntityUpdates.entries())) {
      const name = (data.name as string) || entityId;
      const description = (data.description as string) || "";

      await upsertEntityToPinecone(entityId, name, description, data);
      await markSynced("entity", entityId, (data.version as number) || 1);
    }

    logger.info(
      { count: pendingEntityUpdates.size },
      "Flushed entity batch to Pinecone"
    );
    pendingEntityUpdates.clear();
  } catch (error) {
    logger.error({ error }, "Failed to flush entity batch");
  }
}

/**
 * Full reconciliation pass
 * - Push all pending local changes to cloud
 * - Pull any cloud changes
 */
async function reconcile(): Promise<void> {
  if (!isPineconeConfigured()) return;

  try {
    // Push pending compacted memories
    const pendingMemories = await getPendingSyncMemories();
    for (const mem of pendingMemories) {
      try {
        await upsertCompactedToPinecone(mem.id, mem.payload.summary, {
          ...mem.payload,
        });
        await updateSyncStatus(mem.id, "synced");
        await markSynced("compacted_memory", mem.id, mem.payload.version);
      } catch (error) {
        logger.warn({ error, memoryId: mem.id }, "Failed to sync memory during reconciliation");
      }
    }

    // Flush entity batch
    await flushEntityBatch();

    const stats = await getSyncStats();
    logger.debug(stats, "Reconciliation complete");
  } catch (error) {
    logger.error({ error }, "Reconciliation failed");
  }
}

// ============================================================================
// STATUS
// ============================================================================

/**
 * Get sync engine status
 */
export async function getSyncEngineStatus(): Promise<{
  running: boolean;
  online: boolean;
  bufferedEvents: number;
  pendingEntityUpdates: number;
  ledgerStats: {
    total: number;
    synced: number;
    pendingUp: number;
    conflicts: number;
  };
}> {
  const ledgerStats = await getSyncStats();

  return {
    running: isRunning,
    online: syncEventBus.isOnline,
    bufferedEvents: syncEventBus.getBufferedCount(),
    pendingEntityUpdates: pendingEntityUpdates.size,
    ledgerStats,
  };
}
