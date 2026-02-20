/**
 * Cloud Agent
 *
 * Lightweight agent for mobile access when the Mac is offline.
 * Answers questions from compacted memory in Pinecone, and queues
 * heavy tasks for local execution when the Mac comes back online.
 */

import { logger } from "../logger";
import {
  searchPinecone,
  isPineconeConfigured,
} from "../memory/pinecone-store";
import { enqueueTask } from "./task-queue";
import { PINECONE_NAMESPACES } from "../memory/schemas";

export interface CloudAgentResponse {
  answer: string;
  sources: Array<{
    id: string;
    score: number;
    summary: string;
  }>;
  queued?: {
    taskId: string;
    taskType: string;
  };
}

/**
 * Handle a query from mobile/cloud
 * - If Pinecone has good context, answer directly
 * - If heavy computation needed, queue for local
 */
export async function handleCloudQuery(
  query: string,
  options: {
    source?: string;
    requireDeepAnalysis?: boolean;
  } = {}
): Promise<CloudAgentResponse> {
  const { source = "mobile", requireDeepAnalysis = false } = options;

  if (!isPineconeConfigured()) {
    return {
      answer: "Cloud memory not configured. Query will be processed when local system is available.",
      sources: [],
    };
  }

  try {
    // Search compacted memories
    const results = await searchPinecone(query, {
      namespace: PINECONE_NAMESPACES.COMPACTED,
      topK: 5,
    });

    // Also search entities for context
    const entityResults = await searchPinecone(query, {
      namespace: PINECONE_NAMESPACES.ENTITIES,
      topK: 3,
    });

    const sources = results.map((r) => ({
      id: r.id,
      score: r.score,
      summary: (r.metadata.summary as string) || "",
    }));

    // If deep analysis requested or no good results, queue for local
    if (requireDeepAnalysis || results.length === 0 || results[0].score < 0.5) {
      const task = await enqueueTask({
        taskType: requireDeepAnalysis ? "deep_analysis" : "heavy_summarize",
        payload: {
          query,
          source,
          context: results.map((r) => r.metadata),
          entityContext: entityResults.map((r) => r.metadata),
        },
        priority: requireDeepAnalysis ? 3 : 5,
        source,
      });

      const answer =
        results.length > 0
          ? buildAnswerFromContext(query, results, entityResults)
          : "I don't have enough context to answer this fully. I've queued this for deeper analysis when your local system is available.";

      return {
        answer,
        sources,
        queued: { taskId: task.id, taskType: task.taskType },
      };
    }

    // Build answer from compacted memory
    const answer = buildAnswerFromContext(query, results, entityResults);

    return { answer, sources };
  } catch (error) {
    logger.error({ error, query }, "Cloud agent query failed");
    return {
      answer: "Unable to process query. Error has been logged.",
      sources: [],
    };
  }
}

/**
 * Accept a mobile write (capture/note) and store for local processing
 */
export async function acceptMobileWrite(input: {
  text: string;
  source: string;
  domain?: string;
}): Promise<{ taskId: string }> {
  const task = await enqueueTask({
    taskType: "heavy_summarize",
    payload: {
      messages: [{ role: "user", content: input.text }],
      source: input.source,
      domain: input.domain || "personal",
    },
    priority: 7, // Lower priority than query-based tasks
    source: input.source,
  });

  return { taskId: task.id };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build a basic answer from Pinecone search results
 */
function buildAnswerFromContext(
  query: string,
  results: Array<{ id: string; score: number; metadata: Record<string, unknown> }>,
  entityResults: Array<{ id: string; score: number; metadata: Record<string, unknown> }>
): string {
  const parts: string[] = [];

  // Add relevant summaries
  for (const r of results.slice(0, 3)) {
    const summary = r.metadata.summary as string;
    if (summary) {
      parts.push(summary);
    }

    const decisions = r.metadata.key_decisions as string[];
    if (decisions?.length > 0) {
      parts.push(`Related decisions: ${decisions.join("; ")}`);
    }
  }

  // Add entity context
  for (const e of entityResults.slice(0, 2)) {
    const name = e.metadata.name as string;
    const desc = e.metadata.description as string;
    if (name && desc) {
      parts.push(`${name}: ${desc}`);
    }
  }

  if (parts.length === 0) {
    return "No relevant context found in memory.";
  }

  return `Based on stored context:\n\n${parts.join("\n\n")}`;
}
