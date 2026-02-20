/**
 * Sync Ledger
 *
 * Version tracking per entity between local Qdrant and cloud Pinecone.
 * Stored in PostgreSQL for durability.
 */

import { eq, and } from "drizzle-orm";
import { logger } from "../logger";
import { memorySyncLedger, type SyncLedgerEntry, type InsertSyncLedgerEntry } from "@shared/schema";

// We need a db reference - import from storage
let db: any = null;

async function getDb() {
  if (!db) {
    const { storage } = await import("../storage");
    db = (storage as any).db;
  }
  return db;
}

/**
 * Get or create a ledger entry for an entity
 */
export async function getOrCreateLedgerEntry(
  entityType: string,
  entityId: string
): Promise<SyncLedgerEntry> {
  const database = await getDb();

  const existing = await database
    .select()
    .from(memorySyncLedger)
    .where(
      and(
        eq(memorySyncLedger.entityType, entityType),
        eq(memorySyncLedger.entityId, entityId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  const [entry] = await database
    .insert(memorySyncLedger)
    .values({
      entityType,
      entityId,
      localVersion: 1,
      cloudVersion: 0,
      status: "pending_up",
    })
    .returning();

  return entry;
}

/**
 * Mark entity as synced to cloud
 */
export async function markSynced(
  entityType: string,
  entityId: string,
  version: number
): Promise<void> {
  const database = await getDb();

  await database
    .update(memorySyncLedger)
    .set({
      cloudVersion: version,
      lastSyncAt: new Date(),
      syncDirection: "up",
      status: "synced",
    })
    .where(
      and(
        eq(memorySyncLedger.entityType, entityType),
        eq(memorySyncLedger.entityId, entityId)
      )
    );
}

/**
 * Increment local version (after local update)
 */
export async function incrementLocalVersion(
  entityType: string,
  entityId: string
): Promise<number> {
  const entry = await getOrCreateLedgerEntry(entityType, entityId);
  const newVersion = entry.localVersion + 1;

  const database = await getDb();
  await database
    .update(memorySyncLedger)
    .set({
      localVersion: newVersion,
      status: entry.cloudVersion < newVersion ? "pending_up" : "synced",
    })
    .where(eq(memorySyncLedger.id, entry.id));

  return newVersion;
}

/**
 * Get all entries pending sync (local version > cloud version)
 */
export async function getPendingEntries(): Promise<SyncLedgerEntry[]> {
  const database = await getDb();

  return database
    .select()
    .from(memorySyncLedger)
    .where(eq(memorySyncLedger.status, "pending_up"));
}

/**
 * Mark entry as having a conflict
 */
export async function markConflict(
  entityType: string,
  entityId: string
): Promise<void> {
  const database = await getDb();

  await database
    .update(memorySyncLedger)
    .set({
      syncDirection: "conflict",
      status: "conflict",
    })
    .where(
      and(
        eq(memorySyncLedger.entityType, entityType),
        eq(memorySyncLedger.entityId, entityId)
      )
    );
}

/**
 * Get sync stats
 */
export async function getSyncStats(): Promise<{
  total: number;
  synced: number;
  pendingUp: number;
  conflicts: number;
}> {
  const database = await getDb();

  const all = await database.select().from(memorySyncLedger);

  return {
    total: all.length,
    synced: all.filter((e: SyncLedgerEntry) => e.status === "synced").length,
    pendingUp: all.filter((e: SyncLedgerEntry) => e.status === "pending_up").length,
    conflicts: all.filter((e: SyncLedgerEntry) => e.status === "conflict").length,
  };
}
