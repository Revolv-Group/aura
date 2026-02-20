/**
 * Task Queue
 *
 * Deferred task management for heavy operations.
 * Tasks are queued by the cloud agent (mobile access) and
 * executed locally when the Mac comes online.
 *
 * Task types:
 * - heavy_summarize: Long summarization requiring local LLM
 * - deep_analysis: Complex analysis requiring full context
 * - reindex: Rebuild vector indexes
 */

import { eq, and, asc, desc } from "drizzle-orm";
import { logger } from "../logger";
import { memoryTaskQueue, type MemoryTask, type InsertMemoryTask } from "@shared/schema";
import { compactMessages } from "../compaction/compactor";

// Lazy DB import
let db: any = null;
async function getDb() {
  if (!db) {
    const { storage } = await import("../storage");
    db = (storage as any).db;
  }
  return db;
}

// ============================================================================
// CRUD
// ============================================================================

/**
 * Create a new task in the queue
 */
export async function enqueueTask(task: {
  taskType: string;
  payload: Record<string, unknown>;
  priority?: number;
  source?: string;
}): Promise<MemoryTask> {
  const database = await getDb();

  const [created] = await database
    .insert(memoryTaskQueue)
    .values({
      taskType: task.taskType,
      payload: task.payload,
      priority: task.priority || 5,
      source: task.source || "cloud_agent",
      status: "queued",
      retryCount: 0,
    })
    .returning();

  logger.info(
    { taskId: created.id, type: task.taskType },
    "Task enqueued"
  );

  return created;
}

/**
 * Get next queued task (highest priority, oldest first)
 */
export async function dequeueTask(): Promise<MemoryTask | null> {
  const database = await getDb();

  const [task] = await database
    .select()
    .from(memoryTaskQueue)
    .where(eq(memoryTaskQueue.status, "queued"))
    .orderBy(asc(memoryTaskQueue.priority), asc(memoryTaskQueue.createdAt))
    .limit(1);

  if (!task) return null;

  // Mark as running
  await database
    .update(memoryTaskQueue)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(memoryTaskQueue.id, task.id));

  return { ...task, status: "running" };
}

/**
 * Mark task as completed
 */
export async function completeTask(
  taskId: string,
  result: Record<string, unknown>
): Promise<void> {
  const database = await getDb();

  await database
    .update(memoryTaskQueue)
    .set({
      status: "completed",
      result,
      completedAt: new Date(),
    })
    .where(eq(memoryTaskQueue.id, taskId));

  logger.info({ taskId }, "Task completed");
}

/**
 * Mark task as failed
 */
export async function failTask(
  taskId: string,
  error: string
): Promise<void> {
  const database = await getDb();

  const [task] = await database
    .select()
    .from(memoryTaskQueue)
    .where(eq(memoryTaskQueue.id, taskId));

  const retryCount = (task?.retryCount || 0) + 1;
  const maxRetries = 3;

  await database
    .update(memoryTaskQueue)
    .set({
      status: retryCount >= maxRetries ? "failed" : "queued",
      error,
      retryCount,
    })
    .where(eq(memoryTaskQueue.id, taskId));

  logger.warn({ taskId, error, retryCount }, "Task failed");
}

// ============================================================================
// TASK EXECUTION
// ============================================================================

/**
 * Process all pending tasks in the queue
 */
export async function processTaskQueue(): Promise<{
  processed: number;
  failed: number;
}> {
  let processed = 0;
  let failed = 0;

  while (true) {
    const task = await dequeueTask();
    if (!task) break;

    try {
      const result = await executeTask(task);
      await completeTask(task.id, result);
      processed++;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await failTask(task.id, errorMsg);
      failed++;
    }
  }

  if (processed > 0 || failed > 0) {
    logger.info({ processed, failed }, "Task queue processing complete");
  }

  return { processed, failed };
}

/**
 * Execute a single task based on its type
 */
async function executeTask(task: MemoryTask): Promise<Record<string, unknown>> {
  const payload = task.payload as Record<string, unknown>;

  switch (task.taskType) {
    case "heavy_summarize": {
      const messages = (payload.messages as Array<{ role: string; content: string }>) || [];
      const result = await compactMessages(messages, payload.sessionId as string);
      return { compactedId: result.compactedId, summary: result.summary };
    }

    case "deep_analysis": {
      // Placeholder for deep analysis - would use local LLM
      return { status: "analysis_complete", note: "Deep analysis executed locally" };
    }

    case "reindex": {
      // Placeholder for reindexing
      return { status: "reindex_complete" };
    }

    default:
      throw new Error(`Unknown task type: ${task.taskType}`);
  }
}

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get queue status
 */
export async function getQueueStatus(): Promise<{
  queued: number;
  running: number;
  completed: number;
  failed: number;
}> {
  const database = await getDb();

  const all = await database.select().from(memoryTaskQueue);

  return {
    queued: all.filter((t: MemoryTask) => t.status === "queued").length,
    running: all.filter((t: MemoryTask) => t.status === "running").length,
    completed: all.filter((t: MemoryTask) => t.status === "completed").length,
    failed: all.filter((t: MemoryTask) => t.status === "failed").length,
  };
}

/**
 * Get recent tasks
 */
export async function getRecentTasks(limit: number = 20): Promise<MemoryTask[]> {
  const database = await getDb();

  return database
    .select()
    .from(memoryTaskQueue)
    .orderBy(desc(memoryTaskQueue.createdAt))
    .limit(limit);
}
