/**
 * Local Embedder - Ollama Integration
 *
 * Generates embeddings locally using nomic-embed-text-v1.5 via Ollama.
 * Produces 1024-dim vectors. Uses task prefixes per Nomic spec:
 * - "search_document:" for storage
 * - "search_query:" for retrieval
 */

import { logger } from "../logger";
import { LOCAL_EMBEDDING_DIMS, PINECONE_EMBEDDING_DIMS } from "./schemas";

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const EMBEDDING_MODEL = "nomic-embed-text";

export interface LocalEmbeddingResult {
  embedding: number[];
  model: string;
  dims: number;
}

/**
 * Generate embedding for a single text via Ollama
 */
export async function generateLocalEmbedding(
  text: string,
  mode: "document" | "query" = "document"
): Promise<LocalEmbeddingResult> {
  const prefix = mode === "document" ? "search_document: " : "search_query: ";
  const prefixedText = prefix + text;

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: prefixedText,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama embedding error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const embedding = data.embeddings?.[0];

    if (!embedding || !Array.isArray(embedding)) {
      throw new Error("Invalid Ollama embedding response structure");
    }

    return {
      embedding,
      model: EMBEDDING_MODEL,
      dims: embedding.length,
    };
  } catch (error) {
    logger.error({ error, textLength: text.length }, "Failed to generate local embedding");
    throw error;
  }
}

/**
 * Generate embeddings for multiple texts via Ollama (batched)
 */
export async function generateLocalEmbeddings(
  texts: string[],
  mode: "document" | "query" = "document"
): Promise<LocalEmbeddingResult[]> {
  if (texts.length === 0) return [];

  const prefix = mode === "document" ? "search_document: " : "search_query: ";
  const prefixedTexts = texts.map((t) => prefix + t);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: prefixedTexts,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama batch embedding error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const embeddings = data.embeddings;

    if (!Array.isArray(embeddings)) {
      throw new Error("Invalid Ollama batch embedding response");
    }

    return embeddings.map((emb: number[]) => ({
      embedding: emb,
      model: EMBEDDING_MODEL,
      dims: emb.length,
    }));
  } catch (error) {
    logger.error({ error, count: texts.length }, "Failed to generate local embeddings batch");
    throw error;
  }
}

/**
 * Truncate embedding to target dimensions (Matryoshka property)
 * nomic-embed-text-v1.5 supports Matryoshka: 768, 512, 256, 128, 64 dims
 */
export function truncateEmbedding(
  embedding: number[],
  targetDims: number = PINECONE_EMBEDDING_DIMS
): number[] {
  if (embedding.length <= targetDims) return embedding;

  const truncated = embedding.slice(0, targetDims);

  // Re-normalize after truncation
  const norm = Math.sqrt(truncated.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    return truncated.map((v) => v / norm);
  }
  return truncated;
}

/**
 * Check if Ollama is available and the embedding model is loaded
 */
export async function isOllamaAvailable(): Promise<{
  available: boolean;
  modelLoaded: boolean;
  error?: string;
}> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      return { available: false, modelLoaded: false, error: "Ollama not responding" };
    }

    const data = await response.json();
    const models = data.models || [];
    const modelLoaded = models.some(
      (m: { name: string }) =>
        m.name.startsWith(EMBEDDING_MODEL)
    );

    return { available: true, modelLoaded };
  } catch (error) {
    return {
      available: false,
      modelLoaded: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}
