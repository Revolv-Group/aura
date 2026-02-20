/**
 * Pinecone Store - Cloud Vector Database
 *
 * Cloud mirror for compacted memories, entities, and decisions.
 * Uses 512-dim vectors (Matryoshka truncation from 1024) to halve storage costs.
 *
 * Namespaces:
 * - compacted: High-signal compacted summaries
 * - entities: Entity snapshots
 * - decisions: Decision log entries
 */

import { Pinecone } from "@pinecone-database/pinecone";
import { logger } from "../logger";
import { generateLocalEmbedding, truncateEmbedding } from "./local-embedder";
import { PINECONE_NAMESPACES, PINECONE_EMBEDDING_DIMS } from "./schemas";

// ============================================================================
// CLIENT SETUP
// ============================================================================

let pineconeClient: Pinecone | null = null;

function getClient(): Pinecone {
  if (!pineconeClient) {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) {
      throw new Error("PINECONE_API_KEY not set");
    }
    pineconeClient = new Pinecone({ apiKey });
  }
  return pineconeClient;
}

function getIndex() {
  const indexName = process.env.PINECONE_INDEX || "sbos-memory";
  return getClient().index(indexName);
}

// ============================================================================
// UPSERT
// ============================================================================

export interface PineconeRecord {
  id: string;
  values?: number[];
  metadata: Record<string, unknown>;
}

/**
 * Upsert records into a Pinecone namespace
 */
export async function upsertToPinecone(
  namespace: string,
  records: Array<{
    id: string;
    text: string;
    metadata: Record<string, unknown>;
  }>
): Promise<void> {
  if (records.length === 0) return;

  const index = getIndex().namespace(namespace);

  // Generate and truncate embeddings
  const { generateLocalEmbeddings } = await import("./local-embedder");
  const texts = records.map((r) => r.text);
  const embeddings = await generateLocalEmbeddings(texts, "document");

  const vectors = records.map((record, i) => ({
    id: record.id,
    values: truncateEmbedding(embeddings[i].embedding, PINECONE_EMBEDDING_DIMS),
    metadata: record.metadata as Record<string, string | number | boolean | string[]>,
  }));

  // Pinecone batch limit is 100
  for (let i = 0; i < vectors.length; i += 100) {
    const batch = vectors.slice(i, i + 100);
    await index.upsert(batch as any);
  }

  logger.debug(
    { namespace, count: records.length },
    "Upserted records to Pinecone"
  );
}

/**
 * Upsert a single compacted memory to Pinecone
 */
export async function upsertCompactedToPinecone(
  id: string,
  summary: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await upsertToPinecone(PINECONE_NAMESPACES.COMPACTED, [
    { id, text: summary, metadata: { ...metadata, summary } },
  ]);
}

/**
 * Upsert an entity snapshot to Pinecone
 */
export async function upsertEntityToPinecone(
  id: string,
  name: string,
  description: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await upsertToPinecone(PINECONE_NAMESPACES.ENTITIES, [
    { id, text: `${name}: ${description}`, metadata: { ...metadata, name, description } },
  ]);
}

// ============================================================================
// SEARCH
// ============================================================================

export interface PineconeSearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

/**
 * Search Pinecone by vector similarity
 */
export async function searchPinecone(
  query: string,
  options: {
    namespace?: string;
    topK?: number;
    filter?: Record<string, unknown>;
  } = {}
): Promise<PineconeSearchResult[]> {
  const {
    namespace = PINECONE_NAMESPACES.COMPACTED,
    topK = 10,
    filter,
  } = options;

  const index = getIndex().namespace(namespace);

  // Generate and truncate query embedding
  const embedding = await generateLocalEmbedding(query, "query");
  const truncated = truncateEmbedding(embedding.embedding, PINECONE_EMBEDDING_DIMS);

  const queryOptions: Record<string, unknown> = {
    vector: truncated,
    topK,
    includeMetadata: true,
  };

  if (filter) {
    queryOptions.filter = filter;
  }

  const results = await index.query(queryOptions as any);

  return (results.matches || []).map((m) => ({
    id: m.id,
    score: m.score || 0,
    metadata: (m.metadata as Record<string, unknown>) || {},
  }));
}

// ============================================================================
// DELETE
// ============================================================================

/**
 * Delete records from Pinecone
 */
export async function deleteFromPinecone(
  namespace: string,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;

  const index = getIndex().namespace(namespace);
  await index.deleteMany(ids);

  logger.debug({ namespace, count: ids.length }, "Deleted records from Pinecone");
}

// ============================================================================
// STATUS
// ============================================================================

/**
 * Check Pinecone connectivity and index stats
 */
export async function getPineconeStatus(): Promise<{
  available: boolean;
  indexName: string;
  stats?: {
    totalRecordCount: number;
    namespaces: Record<string, { recordCount: number }>;
  };
  error?: string;
}> {
  const indexName = process.env.PINECONE_INDEX || "sbos-memory";

  try {
    if (!process.env.PINECONE_API_KEY) {
      return { available: false, indexName, error: "PINECONE_API_KEY not set" };
    }

    const index = getIndex();
    const stats = await index.describeIndexStats();

    return {
      available: true,
      indexName,
      stats: {
        totalRecordCount: stats.totalRecordCount || 0,
        namespaces: (stats.namespaces as Record<string, { recordCount: number }>) || {},
      },
    };
  } catch (error) {
    return {
      available: false,
      indexName,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/**
 * Check if Pinecone is configured
 */
export function isPineconeConfigured(): boolean {
  return !!process.env.PINECONE_API_KEY;
}
