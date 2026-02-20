/**
 * Initialize Qdrant Collections
 *
 * Run: npx tsx scripts/init-collections.ts
 *
 * Creates the three memory collections in Qdrant:
 * - raw_memories
 * - compacted_memories
 * - entity_index
 */

import { initCollections } from "../server/memory/qdrant-store";

async function main() {
  console.log("Initializing Qdrant collections...");

  try {
    await initCollections();
    console.log("Collections initialized successfully!");
  } catch (error) {
    console.error("Failed to initialize collections:", error);
    process.exit(1);
  }
}

main();
