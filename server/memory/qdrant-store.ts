/**
 * Qdrant Store - Local Vector Database
 *
 * Manages three collections:
 * - raw_memories: verbatim conversation messages
 * - compacted_memories: compaction summaries
 * - entity_index: people, orgs, projects, concepts
 *
 * Uses nomic-embed-text-v1.5 (1024 dims) via Ollama for local embeddings.
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import { logger } from "../logger";
import { generateLocalEmbedding } from "./local-embedder";
import {
  QDRANT_COLLECTIONS,
  LOCAL_EMBEDDING_DIMS,
  type RawMemoryPayload,
  type CompactedMemoryPayload,
  type EntityPayload,
} from "./schemas";
import { createHash, randomUUID } from "crypto";

// ============================================================================
// CLIENT SETUP
// ============================================================================

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";

let client: QdrantClient | null = null;

function getClient(): QdrantClient {
  if (!client) {
    client = new QdrantClient({ url: QDRANT_URL });
  }
  return client;
}

// ============================================================================
// COLLECTION MANAGEMENT
// ============================================================================

/**
 * Initialize all Qdrant collections if they don't exist
 */
export async function initCollections(): Promise<void> {
  const qdrant = getClient();

  const collections = [
    QDRANT_COLLECTIONS.RAW_MEMORIES,
    QDRANT_COLLECTIONS.COMPACTED_MEMORIES,
    QDRANT_COLLECTIONS.ENTITY_INDEX,
  ];

  for (const name of collections) {
    try {
      const exists = await qdrant.collectionExists(name);
      if (!exists.exists) {
        await qdrant.createCollection(name, {
          vectors: {
            size: LOCAL_EMBEDDING_DIMS,
            distance: "Cosine",
          },
        });

        // Create payload indexes for common query patterns
        if (name === QDRANT_COLLECTIONS.RAW_MEMORIES) {
          await qdrant.createPayloadIndex(name, {
            field_name: "session_id",
            field_schema: "keyword",
          });
          await qdrant.createPayloadIndex(name, {
            field_name: "domain",
            field_schema: "keyword",
          });
          await qdrant.createPayloadIndex(name, {
            field_name: "compacted",
            field_schema: "bool",
          });
          await qdrant.createPayloadIndex(name, {
            field_name: "timestamp",
            field_schema: "integer",
          });
        }

        if (name === QDRANT_COLLECTIONS.COMPACTED_MEMORIES) {
          await qdrant.createPayloadIndex(name, {
            field_name: "domain",
            field_schema: "keyword",
          });
          await qdrant.createPayloadIndex(name, {
            field_name: "sync_status",
            field_schema: "keyword",
          });
          await qdrant.createPayloadIndex(name, {
            field_name: "timestamp",
            field_schema: "integer",
          });
        }

        if (name === QDRANT_COLLECTIONS.ENTITY_INDEX) {
          await qdrant.createPayloadIndex(name, {
            field_name: "entity_type",
            field_schema: "keyword",
          });
          await qdrant.createPayloadIndex(name, {
            field_name: "name",
            field_schema: "keyword",
          });
        }

        logger.info({ collection: name }, "Created Qdrant collection");
      }
    } catch (error) {
      logger.error({ error, collection: name }, "Failed to init Qdrant collection");
      throw error;
    }
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function computeChecksum(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ============================================================================
// RAW MEMORIES CRUD
// ============================================================================

/**
 * Store a raw memory (conversation message) in Qdrant
 */
export async function upsertRawMemory(
  payload: Omit<RawMemoryPayload, "checksum" | "version" | "compacted"> & {
    id?: string;
  }
): Promise<string> {
  const qdrant = getClient();
  const id = payload.id || randomUUID();
  const checksum = computeChecksum(payload.text);

  const embedding = await generateLocalEmbedding(payload.text, "document");

  const fullPayload: RawMemoryPayload = {
    ...payload,
    compacted: false,
    version: 1,
    checksum,
  };

  await qdrant.upsert(QDRANT_COLLECTIONS.RAW_MEMORIES, {
    wait: true,
    points: [
      {
        id,
        vector: embedding.embedding,
        payload: fullPayload as Record<string, unknown>,
      },
    ],
  });

  return id;
}

/**
 * Store multiple raw memories in batch
 */
export async function upsertRawMemories(
  memories: Array<
    Omit<RawMemoryPayload, "checksum" | "version" | "compacted"> & { id?: string }
  >
): Promise<string[]> {
  if (memories.length === 0) return [];

  const qdrant = getClient();
  const { generateLocalEmbeddings } = await import("./local-embedder");

  const texts = memories.map((m) => m.text);
  const embeddings = await generateLocalEmbeddings(texts, "document");

  const ids: string[] = [];
  const points = memories.map((mem, i) => {
    const id = mem.id || randomUUID();
    ids.push(id);
    return {
      id,
      vector: embeddings[i].embedding,
      payload: {
        ...mem,
        compacted: false,
        version: 1,
        checksum: computeChecksum(mem.text),
      } as Record<string, unknown>,
    };
  });

  await qdrant.upsert(QDRANT_COLLECTIONS.RAW_MEMORIES, {
    wait: true,
    points,
  });

  return ids;
}

/**
 * Mark raw memories as compacted
 */
export async function markAsCompacted(ids: string[]): Promise<void> {
  const qdrant = getClient();

  for (const id of ids) {
    await qdrant.setPayload(QDRANT_COLLECTIONS.RAW_MEMORIES, {
      payload: { compacted: true },
      points: [id],
    });
  }
}

/**
 * Get raw memories by session ID
 */
export async function getRawMemoriesBySession(
  sessionId: string
): Promise<Array<{ id: string; payload: RawMemoryPayload }>> {
  const qdrant = getClient();

  const result = await qdrant.scroll(QDRANT_COLLECTIONS.RAW_MEMORIES, {
    filter: {
      must: [{ key: "session_id", match: { value: sessionId } }],
    },
    limit: 1000,
    with_payload: true,
  });

  return result.points.map((p) => ({
    id: p.id as string,
    payload: p.payload as unknown as RawMemoryPayload,
  }));
}

/**
 * Get uncompacted raw memories
 */
export async function getUncompactedMemories(
  limit: number = 100
): Promise<Array<{ id: string; payload: RawMemoryPayload }>> {
  const qdrant = getClient();

  const result = await qdrant.scroll(QDRANT_COLLECTIONS.RAW_MEMORIES, {
    filter: {
      must: [{ key: "compacted", match: { value: false } }],
    },
    limit,
    with_payload: true,
    order_by: { key: "timestamp", direction: "asc" },
  });

  return result.points.map((p) => ({
    id: p.id as string,
    payload: p.payload as unknown as RawMemoryPayload,
  }));
}

// ============================================================================
// COMPACTED MEMORIES CRUD
// ============================================================================

/**
 * Store a compacted memory in Qdrant
 */
export async function upsertCompactedMemory(
  payload: CompactedMemoryPayload,
  id?: string
): Promise<string> {
  const qdrant = getClient();
  const pointId = id || randomUUID();

  const embedding = await generateLocalEmbedding(payload.summary, "document");

  await qdrant.upsert(QDRANT_COLLECTIONS.COMPACTED_MEMORIES, {
    wait: true,
    points: [
      {
        id: pointId,
        vector: embedding.embedding,
        payload: payload as Record<string, unknown>,
      },
    ],
  });

  return pointId;
}

/**
 * Get compacted memories pending sync
 */
export async function getPendingSyncMemories(): Promise<
  Array<{ id: string; payload: CompactedMemoryPayload }>
> {
  const qdrant = getClient();

  const result = await qdrant.scroll(QDRANT_COLLECTIONS.COMPACTED_MEMORIES, {
    filter: {
      must: [{ key: "sync_status", match: { value: "pending" } }],
    },
    limit: 100,
    with_payload: true,
  });

  return result.points.map((p) => ({
    id: p.id as string,
    payload: p.payload as unknown as CompactedMemoryPayload,
  }));
}

/**
 * Update sync status of a compacted memory
 */
export async function updateSyncStatus(
  id: string,
  status: "pending" | "synced" | "conflict"
): Promise<void> {
  const qdrant = getClient();

  await qdrant.setPayload(QDRANT_COLLECTIONS.COMPACTED_MEMORIES, {
    payload: { sync_status: status },
    points: [id],
  });
}

// ============================================================================
// ENTITY INDEX CRUD
// ============================================================================

/**
 * Upsert an entity into the entity index
 */
export async function upsertEntity(
  payload: EntityPayload,
  id?: string
): Promise<string> {
  const qdrant = getClient();
  const pointId = id || randomUUID();

  const embeddingText = `${payload.name}: ${payload.description}`;
  const embedding = await generateLocalEmbedding(embeddingText, "document");

  await qdrant.upsert(QDRANT_COLLECTIONS.ENTITY_INDEX, {
    wait: true,
    points: [
      {
        id: pointId,
        vector: embedding.embedding,
        payload: payload as Record<string, unknown>,
      },
    ],
  });

  return pointId;
}

/**
 * Find entity by name (exact match)
 */
export async function findEntityByName(
  name: string
): Promise<{ id: string; payload: EntityPayload } | null> {
  const qdrant = getClient();

  const result = await qdrant.scroll(QDRANT_COLLECTIONS.ENTITY_INDEX, {
    filter: {
      must: [{ key: "name", match: { value: name } }],
    },
    limit: 1,
    with_payload: true,
  });

  if (result.points.length === 0) return null;

  return {
    id: result.points[0].id as string,
    payload: result.points[0].payload as unknown as EntityPayload,
  };
}

/**
 * Update entity with new mention info
 */
export async function updateEntityMention(
  id: string,
  updates: {
    description?: string;
    last_seen: number;
    domain?: string;
    attributes?: Record<string, unknown>;
  }
): Promise<void> {
  const qdrant = getClient();

  // Get current entity to increment mention count
  const points = await qdrant.retrieve(QDRANT_COLLECTIONS.ENTITY_INDEX, {
    ids: [id],
    with_payload: true,
  });

  if (points.length === 0) return;

  const current = points[0].payload as unknown as EntityPayload;

  const payload: Record<string, unknown> = {
    last_seen: updates.last_seen,
    mention_count: current.mention_count + 1,
    version: current.version + 1,
  };

  if (updates.description) {
    payload.description = updates.description;
    payload.checksum = computeChecksum(updates.description);
  }

  if (updates.domain && !current.related_domains.includes(updates.domain)) {
    payload.related_domains = [...current.related_domains, updates.domain];
  }

  if (updates.attributes) {
    payload.attributes = { ...current.attributes, ...updates.attributes };
  }

  await qdrant.setPayload(QDRANT_COLLECTIONS.ENTITY_INDEX, {
    payload,
    points: [id],
  });
}

// ============================================================================
// SEARCH
// ============================================================================

export interface QdrantSearchResult {
  id: string;
  score: number;
  collection: string;
  payload: Record<string, unknown>;
}

/**
 * Search a specific collection by vector similarity
 */
export async function searchCollection(
  collection: string,
  query: string,
  options: {
    limit?: number;
    min_score?: number;
    filter?: Record<string, unknown>;
  } = {}
): Promise<QdrantSearchResult[]> {
  const qdrant = getClient();
  const { limit = 10, min_score = 0.25, filter } = options;

  const embedding = await generateLocalEmbedding(query, "query");

  const results = await qdrant.search(collection, {
    vector: embedding.embedding,
    limit,
    score_threshold: min_score,
    filter: filter as any,
    with_payload: true,
  });

  return results.map((r) => ({
    id: r.id as string,
    score: r.score,
    collection,
    payload: r.payload as Record<string, unknown>,
  }));
}

/**
 * Search across all memory collections
 */
export async function searchAllCollections(
  query: string,
  options: {
    limit?: number;
    min_score?: number;
    collections?: string[];
    domainFilter?: string;
  } = {}
): Promise<QdrantSearchResult[]> {
  const {
    limit = 10,
    min_score = 0.25,
    collections = [
      QDRANT_COLLECTIONS.COMPACTED_MEMORIES,
      QDRANT_COLLECTIONS.RAW_MEMORIES,
      QDRANT_COLLECTIONS.ENTITY_INDEX,
    ],
    domainFilter,
  } = options;

  const filter = domainFilter
    ? { must: [{ key: "domain", match: { value: domainFilter } }] }
    : undefined;

  const searchPromises = collections.map((col) =>
    searchCollection(col, query, { limit, min_score, filter })
  );

  const allResults = (await Promise.all(searchPromises)).flat();

  // Sort by score descending
  allResults.sort((a, b) => b.score - a.score);

  return allResults.slice(0, limit);
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Check Qdrant connectivity and collection status
 */
export async function getQdrantStatus(): Promise<{
  available: boolean;
  collections: Record<string, { count: number }>;
  error?: string;
}> {
  try {
    const qdrant = getClient();
    const collections: Record<string, { count: number }> = {};

    for (const name of Object.values(QDRANT_COLLECTIONS)) {
      try {
        const info = await qdrant.getCollection(name);
        collections[name] = { count: info.points_count || 0 };
      } catch {
        collections[name] = { count: 0 };
      }
    }

    return { available: true, collections };
  } catch (error) {
    return {
      available: false,
      collections: {},
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}
