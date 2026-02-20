/**
 * Compaction Prompt Templates
 *
 * Prompt templates for session compaction (summarization).
 */

export const COMPACTION_SYSTEM_PROMPT = `You are a memory compaction engine for a personal operating system called SB-OS.
Your job is to take raw conversation messages and produce a structured, dense summary that preserves all important information.

Rules:
- Focus on decisions, facts, action items, and key entities
- Preserve exact names, numbers, dates, and commitments
- Classify the domain accurately (health, business, project, personal, finance)
- Be concise but complete - nothing important should be lost
- If there are action items, list them explicitly
- Extract all named entities (people, organizations, projects, concepts)`;

export const COMPACTION_USER_PROMPT = `Compact the following conversation messages into a structured summary.

MESSAGES:
{{messages}}

Respond with ONLY valid JSON matching this exact schema:
{
  "summary": "Dense 2-4 paragraph summary preserving all key information",
  "key_decisions": ["Decision 1", "Decision 2"],
  "key_facts": ["Fact 1", "Fact 2"],
  "key_entities": ["Entity name 1", "Entity name 2"],
  "domain": "business|health|project|personal|finance",
  "action_items": ["Action 1", "Action 2"],
  "emotional_tone": "neutral|positive|negative|urgent|reflective"
}`;

/**
 * Build the compaction user prompt with actual messages
 */
export function buildCompactionPrompt(messages: string[]): string {
  const formattedMessages = messages
    .map((m, i) => `[${i + 1}] ${m}`)
    .join("\n\n");

  return COMPACTION_USER_PROMPT.replace("{{messages}}", formattedMessages);
}

export const ENTITY_EXTRACTION_PROMPT = `Extract all named entities from the following text. For each entity, provide:
- name: The entity name
- entity_type: person, organization, project, concept, or location
- description: Brief description based on context

Text:
{{text}}

Respond with ONLY valid JSON array:
[{"name": "...", "entity_type": "...", "description": "..."}]`;

/**
 * Build entity extraction prompt
 */
export function buildEntityExtractionPrompt(text: string): string {
  return ENTITY_EXTRACTION_PROMPT.replace("{{text}}", text);
}
