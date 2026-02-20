/**
 * Hybrid Retriever
 *
 * Unified retrieval across local Qdrant and cloud Pinecone.
 * Strategy: local-first, cloud-fallback.
 *
 * Scoring formula:
 *   final_score = 0.70 * cosine_similarity
 *               + 0.15 * recency_decay(half_life=30d)
 *               + 0.15 * importance_score
 */

import { logger } from "../logger";
import {
  searchCollection,
  searchAllCollections,
  type QdrantSearchResult,
} from "./qdrant-store";
import { QDRANT_COLLECTIONS, type MemorySearchOptions } from "./schemas";

// ============================================================================
// SCORING
// ============================================================================

const COSINE_WEIGHT = 0.70;
const RECENCY_WEIGHT = 0.15;
const IMPORTANCE_WEIGHT = 0.15;
const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Calculate recency decay with configurable half-life
 */
function recencyDecay(timestampMs: number, halfLifeMs: number = RECENCY_HALF_LIFE_MS): number {
  const age = Date.now() - timestampMs;
  if (age <= 0) return 1.0;
  return Math.pow(0.5, age / halfLifeMs);
}

/**
 * Calculate final weighted score for a memory result
 */
function calculateFinalScore(
  cosineSimilarity: number,
  timestamp: number,
  importance: number
): number {
  return (
    COSINE_WEIGHT * cosineSimilarity +
    RECENCY_WEIGHT * recencyDecay(timestamp) +
    IMPORTANCE_WEIGHT * importance
  );
}

// ============================================================================
// RESULT TYPES
// ============================================================================

export interface RetrievedMemory {
  id: string;
  collection: string;
  rawScore: number;
  finalScore: number;
  text: string;
  timestamp: number;
  domain?: string;
  metadata: Record<string, unknown>;
  source: "local" | "cloud";
}

// ============================================================================
// RETRIEVAL
// ============================================================================

/**
 * Retrieve relevant memories using hybrid scoring
 */
export async function retrieveMemories(
  query: string,
  options: Partial<MemorySearchOptions> = {}
): Promise<RetrievedMemory[]> {
  const {
    limit = 10,
    min_score = 0.25,
    include_raw = false,
    include_compacted = true,
    include_entities = true,
    domains,
  } = options;

  const collections: string[] = [];
  if (include_compacted) collections.push(QDRANT_COLLECTIONS.COMPACTED_MEMORIES);
  if (include_raw) collections.push(QDRANT_COLLECTIONS.RAW_MEMORIES);
  if (include_entities) collections.push(QDRANT_COLLECTIONS.ENTITY_INDEX);

  try {
    // Step 1: Search local Qdrant
    const localResults = await searchAllCollections(query, {
      limit: limit * 2, // Fetch extra for re-ranking
      min_score: min_score * 0.7, // Lower threshold, we'll re-score
      collections,
      domainFilter: domains?.[0], // Simple filter for now
    });

    // Step 2: Re-score with full formula
    const scored: RetrievedMemory[] = localResults.map((r) => {
      const payload = r.payload;
      const timestamp = (payload.timestamp as number) || Date.now();
      const importance = (payload.importance as number) || 0.5;
      const text = extractText(r);

      return {
        id: r.id,
        collection: r.collection,
        rawScore: r.score,
        finalScore: calculateFinalScore(r.score, timestamp, importance),
        text,
        timestamp,
        domain: payload.domain as string | undefined,
        metadata: payload,
        source: "local" as const,
      };
    });

    // Step 3: Sort by final score
    scored.sort((a, b) => b.finalScore - a.finalScore);

    // Step 4: Filter by min_score
    const filtered = scored.filter((r) => r.finalScore >= min_score);

    // Step 5: Deduplicate by content checksum
    const deduped = deduplicateResults(filtered);

    // Step 6: If local yields < 3 quality results, try cloud fallback
    if (deduped.length < 3) {
      try {
        const cloudResults = await cloudFallback(query, {
          limit: limit - deduped.length,
          min_score,
        });
        deduped.push(...cloudResults);
      } catch (error) {
        logger.debug({ error }, "Cloud fallback unavailable");
      }
    }

    return deduped.slice(0, limit);
  } catch (error) {
    logger.error({ error, query }, "Memory retrieval failed");
    return [];
  }
}

/**
 * Retrieve memories and format as context string for AI injection
 */
export async function retrieveAsContext(
  query: string,
  options: Partial<MemorySearchOptions> = {}
): Promise<string> {
  const memories = await retrieveMemories(query, options);

  if (memories.length === 0) return "";

  const sections: string[] = [];

  // Group by collection type
  const compacted = memories.filter(
    (m) => m.collection === QDRANT_COLLECTIONS.COMPACTED_MEMORIES
  );
  const entities = memories.filter(
    (m) => m.collection === QDRANT_COLLECTIONS.ENTITY_INDEX
  );
  const raw = memories.filter(
    (m) => m.collection === QDRANT_COLLECTIONS.RAW_MEMORIES
  );

  if (compacted.length > 0) {
    sections.push("### Previous Context (Compacted Memories)");
    for (const m of compacted) {
      const decisions = (m.metadata.key_decisions as string[]) || [];
      const facts = (m.metadata.key_facts as string[]) || [];
      sections.push(m.text);
      if (decisions.length > 0) {
        sections.push(`Decisions: ${decisions.join("; ")}`);
      }
      if (facts.length > 0) {
        sections.push(`Key facts: ${facts.join("; ")}`);
      }
      sections.push("");
    }
  }

  if (entities.length > 0) {
    sections.push("### Known Entities");
    for (const m of entities) {
      const entityType = m.metadata.entity_type as string;
      sections.push(`- **${m.metadata.name}** (${entityType}): ${m.text}`);
    }
    sections.push("");
  }

  if (raw.length > 0) {
    sections.push("### Recent Relevant Messages");
    for (const m of raw) {
      sections.push(m.text.slice(0, 300));
    }
    sections.push("");
  }

  return sections.join("\n");
}

// ============================================================================
// HELPERS
// ============================================================================

function extractText(result: QdrantSearchResult): string {
  const p = result.payload;

  if (result.collection === QDRANT_COLLECTIONS.COMPACTED_MEMORIES) {
    return (p.summary as string) || "";
  }
  if (result.collection === QDRANT_COLLECTIONS.RAW_MEMORIES) {
    return (p.text as string) || "";
  }
  if (result.collection === QDRANT_COLLECTIONS.ENTITY_INDEX) {
    return (p.description as string) || "";
  }
  return "";
}

function deduplicateResults(results: RetrievedMemory[]): RetrievedMemory[] {
  const seen = new Set<string>();
  const deduped: RetrievedMemory[] = [];

  for (const r of results) {
    const checksum = (r.metadata.checksum as string) || r.id;
    if (!seen.has(checksum)) {
      seen.add(checksum);
      deduped.push(r);
    }
  }

  return deduped;
}

/**
 * Cloud fallback - queries Pinecone for compacted memories
 */
async function cloudFallback(
  query: string,
  options: { limit: number; min_score: number }
): Promise<RetrievedMemory[]> {
  // Lazy import to avoid requiring Pinecone when not configured
  try {
    const { searchPinecone } = await import("./pinecone-store");
    const results = await searchPinecone(query, {
      namespace: "compacted",
      topK: options.limit,
    });

    return results.map((r) => ({
      id: r.id,
      collection: "pinecone:compacted",
      rawScore: r.score,
      finalScore: r.score * COSINE_WEIGHT, // Simplified scoring for cloud
      text: (r.metadata?.summary as string) || "",
      timestamp: (r.metadata?.timestamp as number) || Date.now(),
      domain: r.metadata?.domain as string | undefined,
      metadata: r.metadata || {},
      source: "cloud" as const,
    }));
  } catch {
    return [];
  }
}
