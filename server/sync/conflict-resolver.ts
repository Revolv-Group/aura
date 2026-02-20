/**
 * Conflict Resolver
 *
 * Handles conflicts between local Qdrant and cloud Pinecone.
 * Core principle: LOCAL IS AUTHORITATIVE.
 *
 * Conflict types:
 * - Concurrent edit (same entity_id, different versions) -> LWW with local bias
 * - Divergent compactions -> merge key_decisions + key_facts, keep local summary
 * - Mobile write vs local -> staged as pending_mobile_update
 * - Stale cloud (version gap > 5) -> full overwrite from local
 */

import { logger } from "../logger";

export interface ConflictContext {
  entityType: string;
  entityId: string;
  localVersion: number;
  cloudVersion: number;
  localTimestamp: number;
  cloudTimestamp: number;
  localData: Record<string, unknown>;
  cloudData: Record<string, unknown>;
}

export type ConflictResolution =
  | { action: "keep_local"; reason: string }
  | { action: "keep_cloud"; reason: string }
  | { action: "merge"; merged: Record<string, unknown>; reason: string }
  | { action: "overwrite_cloud"; reason: string };

const LOCAL_BIAS_WINDOW_MS = 60000; // 60 seconds
const STALE_VERSION_GAP = 5;

/**
 * Resolve a conflict between local and cloud versions
 */
export function resolveConflict(ctx: ConflictContext): ConflictResolution {
  const versionGap = Math.abs(ctx.localVersion - ctx.cloudVersion);

  // Stale cloud: version gap > 5 -> full overwrite from local
  if (versionGap > STALE_VERSION_GAP && ctx.localVersion > ctx.cloudVersion) {
    return {
      action: "overwrite_cloud",
      reason: `Stale cloud (gap: ${versionGap}), overwriting from local`,
    };
  }

  // LWW with local bias: if timestamps within 60s, local wins
  const timeDiff = Math.abs(ctx.localTimestamp - ctx.cloudTimestamp);
  if (timeDiff <= LOCAL_BIAS_WINDOW_MS) {
    return {
      action: "keep_local",
      reason: `Concurrent edit within ${LOCAL_BIAS_WINDOW_MS}ms window, local wins`,
    };
  }

  // If local is newer, keep local
  if (ctx.localTimestamp > ctx.cloudTimestamp) {
    return {
      action: "keep_local",
      reason: "Local is more recent",
    };
  }

  // For compacted memories, try to merge
  if (ctx.entityType === "compacted_memory") {
    return mergeCompactedMemories(ctx);
  }

  // For entities, merge attributes
  if (ctx.entityType === "entity") {
    return mergeEntities(ctx);
  }

  // Default: cloud is newer, but check if it's a mobile write
  if (ctx.cloudData.source === "mobile") {
    return {
      action: "merge",
      merged: { ...ctx.localData, ...ctx.cloudData, source: "merged" },
      reason: "Mobile write merged with local state",
    };
  }

  // Cloud is genuinely newer
  return {
    action: "keep_cloud",
    reason: "Cloud version is newer and non-conflicting",
  };
}

/**
 * Merge divergent compacted memories
 */
function mergeCompactedMemories(ctx: ConflictContext): ConflictResolution {
  const localDecisions = (ctx.localData.key_decisions as string[]) || [];
  const cloudDecisions = (ctx.cloudData.key_decisions as string[]) || [];
  const localFacts = (ctx.localData.key_facts as string[]) || [];
  const cloudFacts = (ctx.cloudData.key_facts as string[]) || [];
  const localEntities = (ctx.localData.key_entities as string[]) || [];
  const cloudEntities = (ctx.cloudData.key_entities as string[]) || [];

  // Merge: union of decisions, facts, entities; keep local summary
  const merged = {
    ...ctx.localData,
    key_decisions: Array.from(new Set([...localDecisions, ...cloudDecisions])),
    key_facts: Array.from(new Set([...localFacts, ...cloudFacts])),
    key_entities: Array.from(new Set([...localEntities, ...cloudEntities])),
    version: Math.max(ctx.localVersion, ctx.cloudVersion) + 1,
  };

  return {
    action: "merge",
    merged,
    reason: "Merged divergent compactions: union of decisions/facts, local summary kept",
  };
}

/**
 * Merge divergent entities
 */
function mergeEntities(ctx: ConflictContext): ConflictResolution {
  const localAttrs = (ctx.localData.attributes as Record<string, unknown>) || {};
  const cloudAttrs = (ctx.cloudData.attributes as Record<string, unknown>) || {};
  const localDomains = (ctx.localData.related_domains as string[]) || [];
  const cloudDomains = (ctx.cloudData.related_domains as string[]) || [];

  const merged = {
    ...ctx.localData,
    attributes: { ...cloudAttrs, ...localAttrs }, // Local attrs take precedence
    related_domains: Array.from(new Set([...localDomains, ...cloudDomains])),
    mention_count: Math.max(
      (ctx.localData.mention_count as number) || 0,
      (ctx.cloudData.mention_count as number) || 0
    ),
    last_seen: Math.max(
      (ctx.localData.last_seen as number) || 0,
      (ctx.cloudData.last_seen as number) || 0
    ),
    version: Math.max(ctx.localVersion, ctx.cloudVersion) + 1,
  };

  return {
    action: "merge",
    merged,
    reason: "Merged entity: union of domains/attrs, max counts, local precedence",
  };
}
