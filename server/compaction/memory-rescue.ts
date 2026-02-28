/**
 * Pre-Compaction Memory Rescue
 *
 * Inspired by the Rasputin/Cartu Method: run specialized extractors
 * BEFORE compaction to rescue facts that summarization would lose.
 *
 * 3 parallel Cerebras extractors:
 * 1. Facts — numbers, dates, URLs, configs, specs
 * 2. Decisions — architectural decisions, tradeoffs, rationale
 * 3. Skills — procedures, debugging techniques, workarounds
 *
 * Each extracted memory is:
 * - Scored for importance (1-10, threshold 7)
 * - Deduplicated via SHA256 against existing Qdrant memories
 * - Committed to raw_memories with rescued:true metadata
 */

import { createHash } from "crypto";
import { logger } from "../logger";
import { generateCompletion } from "./cerebras-client";
import { upsertRawMemories } from "../memory/qdrant-store";
import { searchCollection } from "../memory/qdrant-store";
import { QDRANT_COLLECTIONS } from "../memory/schemas";

// ============================================================================
// EXTRACTION PROMPTS
// ============================================================================

const FACT_EXTRACTION_PROMPT = `You are a fact extraction engine. Extract ALL concrete facts from the conversation below.

Focus on:
- Numbers, measurements, amounts, prices, percentages
- Dates, deadlines, timestamps, schedules
- URLs, file paths, API endpoints, config values
- Technical specifications, versions, model names
- Names of people, companies, projects, tools
- Exact commands, code snippets, error messages

For each fact, rate importance 1-10:
- 10: Critical business data, credentials, financial figures
- 8-9: Important technical specs, deadlines, commitments
- 6-7: Useful context, preferences, project details
- 4-5: Minor details, general info
- 1-3: Trivial, easily re-derived

MESSAGES:
{{messages}}

Respond with ONLY valid JSON:
{
  "facts": [
    { "text": "exact fact statement", "importance": 8, "category": "technical|business|personal|financial" }
  ]
}`;

const DECISION_EXTRACTION_PROMPT = `You are a decision extraction engine. Extract ALL decisions, choices, and tradeoffs from the conversation below.

Focus on:
- Architecture decisions (chose X over Y because Z)
- Business decisions (pricing, strategy, partnerships)
- Technical tradeoffs (performance vs simplicity, etc.)
- Rejected alternatives and the reasoning
- Commitments made (will do X, agreed to Y)
- Policy decisions (always do X, never do Y)

For each decision, rate importance 1-10:
- 10: Irreversible architecture/business decisions
- 8-9: Significant technical choices, strategy changes
- 6-7: Moderate decisions, preference choices
- 4-5: Minor implementation choices
- 1-3: Trivial, easily changed

MESSAGES:
{{messages}}

Respond with ONLY valid JSON:
{
  "decisions": [
    { "text": "decision statement with rationale", "importance": 8, "category": "architecture|business|technical|policy" }
  ]
}`;

const SKILL_EXTRACTION_PROMPT = `You are a procedural knowledge extraction engine. Extract ALL skills, techniques, and procedures from the conversation below.

Focus on:
- Step-by-step procedures that worked
- Debugging techniques and their outcomes
- Workarounds for specific problems
- Configuration recipes (do A then B then C)
- Patterns that should be replicated
- Anti-patterns to avoid (tried X, it broke Y)
- Tool usage tips and flags

For each skill, rate importance 1-10:
- 10: Critical procedure, would cause major issues if forgotten
- 8-9: Important technique, saves significant time
- 6-7: Useful recipe, good to remember
- 4-5: Minor tip
- 1-3: Common knowledge

MESSAGES:
{{messages}}

Respond with ONLY valid JSON:
{
  "skills": [
    { "text": "procedural description", "importance": 7, "category": "debugging|deployment|configuration|coding|workflow" }
  ]
}`;

// ============================================================================
// TYPES
// ============================================================================

interface ExtractedMemory {
  text: string;
  importance: number;
  category: string;
  type: "fact" | "decision" | "skill";
  hash: string;
}

export interface RescueResult {
  totalExtracted: number;
  totalAfterFilter: number;
  totalAfterDedup: number;
  committed: number;
  duration: number;
  extractorResults: {
    facts: number;
    decisions: number;
    skills: number;
  };
}

// ============================================================================
// CORE RESCUE FUNCTION
// ============================================================================

/**
 * Run pre-compaction memory rescue on a set of messages.
 * Call this BEFORE compactSession() to extract facts that summarization would lose.
 *
 * @param sessionId - The session being compacted
 * @param messageTexts - Formatted message strings (already "[ROLE]: content" format)
 * @param importanceThreshold - Minimum importance score (default 7)
 */
export async function rescueMemories(
  sessionId: string,
  messageTexts: string[],
  importanceThreshold: number = 7
): Promise<RescueResult> {
  const startTime = Date.now();

  if (messageTexts.length === 0) {
    return {
      totalExtracted: 0,
      totalAfterFilter: 0,
      totalAfterDedup: 0,
      committed: 0,
      duration: 0,
      extractorResults: { facts: 0, decisions: 0, skills: 0 },
    };
  }

  const formattedMessages = messageTexts
    .map((m, i) => `[${i + 1}] ${m}`)
    .join("\n\n");

  // Step 1: Run 3 extractors in parallel via Cerebras (fast + cheap)
  const [factsResult, decisionsResult, skillsResult] = await Promise.allSettled([
    extractFacts(formattedMessages),
    extractDecisions(formattedMessages),
    extractSkills(formattedMessages),
  ]);

  const facts = factsResult.status === "fulfilled" ? factsResult.value : [];
  const decisions = decisionsResult.status === "fulfilled" ? decisionsResult.value : [];
  const skills = skillsResult.status === "fulfilled" ? skillsResult.value : [];

  if (factsResult.status === "rejected") {
    logger.warn({ error: factsResult.reason?.message }, "Fact extraction failed");
  }
  if (decisionsResult.status === "rejected") {
    logger.warn({ error: decisionsResult.reason?.message }, "Decision extraction failed");
  }
  if (skillsResult.status === "rejected") {
    logger.warn({ error: skillsResult.reason?.message }, "Skill extraction failed");
  }

  const allExtracted = [...facts, ...decisions, ...skills];
  const extractorResults = {
    facts: facts.length,
    decisions: decisions.length,
    skills: skills.length,
  };

  // Step 2: Filter by importance threshold
  const filtered = allExtracted.filter((m) => m.importance >= importanceThreshold);

  // Step 3: Deduplicate by SHA256 hash (within this batch)
  const seen = new Set<string>();
  const deduped: ExtractedMemory[] = [];
  for (const mem of filtered) {
    if (!seen.has(mem.hash)) {
      seen.add(mem.hash);
      deduped.push(mem);
    }
  }

  if (deduped.length === 0) {
    return {
      totalExtracted: allExtracted.length,
      totalAfterFilter: filtered.length,
      totalAfterDedup: 0,
      committed: 0,
      duration: Date.now() - startTime,
      extractorResults,
    };
  }

  // Step 4: Check for duplicates against existing Qdrant memories
  // Use a representative sample query to check for near-dupes
  const uniqueMemories = await deduplicateAgainstQdrant(deduped);

  if (uniqueMemories.length === 0) {
    return {
      totalExtracted: allExtracted.length,
      totalAfterFilter: filtered.length,
      totalAfterDedup: 0,
      committed: 0,
      duration: Date.now() - startTime,
      extractorResults,
    };
  }

  // Step 5: Commit rescued memories to Qdrant raw_memories
  const memoryInputs = uniqueMemories.map((mem) => ({
    text: `[RESCUED:${mem.type.toUpperCase()}] ${mem.text}`,
    session_id: sessionId,
    timestamp: Date.now(),
    source: "conversation" as const,
    domain: categorizeDomain(mem.category),
    entities: [] as string[],
    importance: mem.importance / 10, // Normalize 1-10 to 0-1
  }));

  try {
    const ids = await upsertRawMemories(memoryInputs);
    const duration = Date.now() - startTime;

    logger.info(
      {
        sessionId,
        totalExtracted: allExtracted.length,
        filtered: filtered.length,
        committed: ids.length,
        duration,
        extractorResults,
      },
      "Memory rescue complete"
    );

    return {
      totalExtracted: allExtracted.length,
      totalAfterFilter: filtered.length,
      totalAfterDedup: uniqueMemories.length,
      committed: ids.length,
      duration,
      extractorResults,
    };
  } catch (error) {
    logger.error({ error, sessionId }, "Failed to commit rescued memories");
    return {
      totalExtracted: allExtracted.length,
      totalAfterFilter: filtered.length,
      totalAfterDedup: uniqueMemories.length,
      committed: 0,
      duration: Date.now() - startTime,
      extractorResults,
    };
  }
}

// ============================================================================
// INDIVIDUAL EXTRACTORS
// ============================================================================

async function extractFacts(messages: string): Promise<ExtractedMemory[]> {
  const prompt = FACT_EXTRACTION_PROMPT.replace("{{messages}}", messages);
  const result = await generateCompletion(
    "You extract concrete facts from conversations. Be thorough but precise.",
    prompt,
    { temperature: 0.1, maxTokens: 2000, jsonMode: true }
  );

  try {
    const parsed = JSON.parse(result.content);
    const items = Array.isArray(parsed.facts) ? parsed.facts : [];
    return items.map((f: { text: string; importance: number; category: string }) => ({
      text: f.text,
      importance: Math.min(10, Math.max(1, f.importance || 5)),
      category: f.category || "technical",
      type: "fact" as const,
      hash: createHash("sha256").update(f.text.toLowerCase().trim()).digest("hex"),
    }));
  } catch {
    logger.warn("Failed to parse fact extraction output");
    return [];
  }
}

async function extractDecisions(messages: string): Promise<ExtractedMemory[]> {
  const prompt = DECISION_EXTRACTION_PROMPT.replace("{{messages}}", messages);
  const result = await generateCompletion(
    "You extract decisions and tradeoffs from conversations. Capture the reasoning.",
    prompt,
    { temperature: 0.1, maxTokens: 2000, jsonMode: true }
  );

  try {
    const parsed = JSON.parse(result.content);
    const items = Array.isArray(parsed.decisions) ? parsed.decisions : [];
    return items.map((d: { text: string; importance: number; category: string }) => ({
      text: d.text,
      importance: Math.min(10, Math.max(1, d.importance || 5)),
      category: d.category || "technical",
      type: "decision" as const,
      hash: createHash("sha256").update(d.text.toLowerCase().trim()).digest("hex"),
    }));
  } catch {
    logger.warn("Failed to parse decision extraction output");
    return [];
  }
}

async function extractSkills(messages: string): Promise<ExtractedMemory[]> {
  const prompt = SKILL_EXTRACTION_PROMPT.replace("{{messages}}", messages);
  const result = await generateCompletion(
    "You extract procedural knowledge and techniques from conversations.",
    prompt,
    { temperature: 0.1, maxTokens: 2000, jsonMode: true }
  );

  try {
    const parsed = JSON.parse(result.content);
    const items = Array.isArray(parsed.skills) ? parsed.skills : [];
    return items.map((s: { text: string; importance: number; category: string }) => ({
      text: s.text,
      importance: Math.min(10, Math.max(1, s.importance || 5)),
      category: s.category || "workflow",
      type: "skill" as const,
      hash: createHash("sha256").update(s.text.toLowerCase().trim()).digest("hex"),
    }));
  } catch {
    logger.warn("Failed to parse skill extraction output");
    return [];
  }
}

// ============================================================================
// DEDUPLICATION
// ============================================================================

/**
 * Check extracted memories against existing Qdrant raw_memories for near-duplicates.
 * Uses vector similarity — if a very similar memory already exists (score > 0.92), skip it.
 */
async function deduplicateAgainstQdrant(
  memories: ExtractedMemory[]
): Promise<ExtractedMemory[]> {
  const unique: ExtractedMemory[] = [];

  // Check in batches to avoid overwhelming Qdrant
  for (const mem of memories) {
    try {
      const results = await searchCollection(
        QDRANT_COLLECTIONS.RAW_MEMORIES,
        mem.text,
        { limit: 1, min_score: 0.92 }
      );

      if (results.length === 0) {
        unique.push(mem);
      } else {
        logger.debug(
          { text: mem.text.slice(0, 80), score: results[0].score },
          "Skipping near-duplicate rescued memory"
        );
      }
    } catch {
      // If Qdrant search fails, include the memory anyway
      unique.push(mem);
    }
  }

  return unique;
}

// ============================================================================
// HELPERS
// ============================================================================

function categorizeDomain(category: string): "health" | "business" | "project" | "personal" | "finance" {
  switch (category) {
    case "financial":
    case "finance":
      return "finance";
    case "business":
    case "architecture":
    case "policy":
      return "business";
    case "technical":
    case "debugging":
    case "deployment":
    case "configuration":
    case "coding":
      return "project";
    case "workflow":
    case "personal":
      return "personal";
    default:
      return "personal";
  }
}
