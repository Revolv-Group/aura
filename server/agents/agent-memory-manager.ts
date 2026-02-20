/**
 * Agent Memory Manager
 *
 * Per-agent persistent memory CRUD with importance scoring and TTL cleanup.
 * Each agent has isolated memory that supplements its conversation history.
 */

import { eq, desc, lt } from "drizzle-orm";
import { logger } from "../logger";
import { agentMemory, type AgentMemoryEntry } from "@shared/schema";

type AgentMemory = AgentMemoryEntry;

// Lazy DB
let db: any = null;
async function getDb() {
  if (!db) {
    const { storage } = await import("../storage");
    db = (storage as any).db;
  }
  return db;
}

// ============================================================================
// MEMORY CRUD
// ============================================================================

export async function storeMemory(params: {
  agentId: string;
  memoryType: "learning" | "preference" | "context" | "relationship";
  content: string;
  importance?: number;
  expiresAt?: Date;
}): Promise<AgentMemory> {
  const database = await getDb();

  const [memory] = await database
    .insert(agentMemory)
    .values({
      agentId: params.agentId,
      memoryType: params.memoryType,
      content: params.content,
      importance: params.importance ?? 0.5,
      expiresAt: params.expiresAt,
    })
    .returning();

  logger.debug(
    { agentId: params.agentId, type: params.memoryType },
    "Memory stored"
  );

  return memory;
}

export async function getMemories(
  agentId: string,
  options: {
    memoryType?: string;
    limit?: number;
    minImportance?: number;
  } = {}
): Promise<AgentMemory[]> {
  const database = await getDb();
  const { limit = 20, minImportance = 0 } = options;

  const results: AgentMemory[] = await database
    .select()
    .from(agentMemory)
    .where(eq(agentMemory.agentId, agentId))
    .orderBy(desc(agentMemory.importance))
    .limit(limit);

  let filtered = results;
  if (options.memoryType) {
    filtered = filtered.filter((m) => m.memoryType === options.memoryType);
  }
  if (minImportance > 0) {
    filtered = filtered.filter((m) => (m.importance || 0) >= minImportance);
  }

  return filtered;
}

export async function updateImportance(
  memoryId: string,
  importance: number
): Promise<void> {
  const database = await getDb();

  await database
    .update(agentMemory)
    .set({ importance: Math.max(0, Math.min(1, importance)) })
    .where(eq(agentMemory.id, memoryId));
}

export async function deleteMemory(memoryId: string): Promise<void> {
  const database = await getDb();

  await database
    .delete(agentMemory)
    .where(eq(agentMemory.id, memoryId));
}

export async function clearMemories(
  agentId: string,
  memoryType?: string
): Promise<{ deleted: number }> {
  const database = await getDb();

  if (memoryType) {
    const all = await database
      .select()
      .from(agentMemory)
      .where(eq(agentMemory.agentId, agentId));

    const toDelete = all.filter((m: AgentMemory) => m.memoryType === memoryType);
    if (toDelete.length > 0) {
      for (const m of toDelete) {
        await database.delete(agentMemory).where(eq(agentMemory.id, m.id));
      }
    }
    return { deleted: toDelete.length };
  }

  const all = await database
    .select()
    .from(agentMemory)
    .where(eq(agentMemory.agentId, agentId));

  await database
    .delete(agentMemory)
    .where(eq(agentMemory.agentId, agentId));

  return { deleted: all.length };
}

// ============================================================================
// MEMORY SEARCH
// ============================================================================

export async function searchMemories(
  agentId: string,
  query: string,
  limit: number = 10
): Promise<AgentMemory[]> {
  const database = await getDb();

  const all = await database
    .select()
    .from(agentMemory)
    .where(eq(agentMemory.agentId, agentId))
    .orderBy(desc(agentMemory.importance));

  const queryLower = query.toLowerCase();
  return all
    .filter((m: AgentMemory) => m.content.toLowerCase().includes(queryLower))
    .slice(0, limit);
}

// ============================================================================
// MEMORY CONTEXT BUILDER
// ============================================================================

export async function buildMemoryContext(
  agentId: string,
  maxTokens: number = 2000
): Promise<string> {
  const memories = await getMemories(agentId, { limit: 30, minImportance: 0.3 });

  if (memories.length === 0) return "";

  const grouped: Record<string, AgentMemory[]> = {};
  for (const m of memories) {
    if (!grouped[m.memoryType]) grouped[m.memoryType] = [];
    grouped[m.memoryType].push(m);
  }

  const sections: string[] = ["## Your Memory"];
  const charBudget = maxTokens * 4;
  let totalChars = 0;

  const typeLabels: Record<string, string> = {
    learning: "Lessons Learned",
    preference: "User Preferences",
    context: "Contextual Knowledge",
    relationship: "Relationships & People",
  };

  for (const [type, mems] of Object.entries(grouped)) {
    const label = typeLabels[type] || type;
    sections.push(`\n### ${label}`);

    for (const m of mems) {
      const line = `- ${m.content}`;
      totalChars += line.length;
      if (totalChars > charBudget) break;
      sections.push(line);
    }

    if (totalChars > charBudget) break;
  }

  return sections.join("\n");
}

// ============================================================================
// CLEANUP
// ============================================================================

export async function cleanupExpiredMemories(): Promise<{ deleted: number }> {
  const database = await getDb();
  const now = new Date();

  const expired = await database
    .select()
    .from(agentMemory)
    .where(lt(agentMemory.expiresAt, now));

  if (expired.length === 0) return { deleted: 0 };

  for (const m of expired) {
    await database.delete(agentMemory).where(eq(agentMemory.id, m.id));
  }

  logger.info({ count: expired.length }, "Cleaned up expired agent memories");
  return { deleted: expired.length };
}

export async function getMemoryStats(agentId: string): Promise<{
  total: number;
  byType: Record<string, number>;
  avgImportance: number;
}> {
  const memories = await getMemories(agentId, { limit: 1000 });

  const byType: Record<string, number> = {};
  let totalImportance = 0;

  for (const m of memories) {
    byType[m.memoryType] = (byType[m.memoryType] || 0) + 1;
    totalImportance += m.importance || 0;
  }

  return {
    total: memories.length,
    byType,
    avgImportance: memories.length > 0 ? totalImportance / memories.length : 0,
  };
}
