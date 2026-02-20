/**
 * Context Monitor
 *
 * Tracks token usage per conversation session and triggers compaction
 * when 80% of context window is filled.
 */

import { logger } from "../logger";
import { estimateTokens } from "../chunking";

// Default context window size (tokens)
const DEFAULT_CONTEXT_WINDOW = 128000;
const COMPACTION_THRESHOLD = 0.8; // 80%
const KEEP_RECENT_EXCHANGES = 3; // Keep last 3 user+assistant pairs

export interface TrackedMessage {
  role: "user" | "assistant" | "system";
  content: string;
  tokens: number;
  timestamp: number;
}

export interface SessionState {
  sessionId: string;
  messages: TrackedMessage[];
  totalTokens: number;
  contextWindow: number;
  compactionCount: number;
}

// In-memory session tracking
const sessions = new Map<string, SessionState>();

/**
 * Get or create a session state
 */
export function getSession(
  sessionId: string,
  contextWindow: number = DEFAULT_CONTEXT_WINDOW
): SessionState {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sessionId,
      messages: [],
      totalTokens: 0,
      contextWindow,
      compactionCount: 0,
    });
  }
  return sessions.get(sessionId)!;
}

/**
 * Add a message to session tracking
 */
export function addMessage(
  sessionId: string,
  role: "user" | "assistant" | "system",
  content: string
): { needsCompaction: boolean; usage: number } {
  const session = getSession(sessionId);
  const tokens = estimateTokens(content);

  session.messages.push({
    role,
    content,
    tokens,
    timestamp: Date.now(),
  });
  session.totalTokens += tokens;

  const usage = session.totalTokens / session.contextWindow;
  const needsCompaction = usage >= COMPACTION_THRESHOLD;

  if (needsCompaction) {
    logger.info(
      {
        sessionId,
        usage: Math.round(usage * 100),
        totalTokens: session.totalTokens,
        messageCount: session.messages.length,
      },
      "Context window threshold reached, compaction needed"
    );
  }

  return { needsCompaction, usage };
}

/**
 * Get messages that should be compacted (everything except system prompt + recent exchanges)
 */
export function getCompactableMessages(sessionId: string): {
  toCompact: TrackedMessage[];
  toKeep: TrackedMessage[];
} {
  const session = getSession(sessionId);
  const messages = session.messages;

  // Keep system messages
  const systemMessages = messages.filter((m) => m.role === "system");

  // Get non-system messages
  const nonSystem = messages.filter((m) => m.role !== "system");

  // Keep last N exchanges (user + assistant pairs)
  const exchangesToKeep = KEEP_RECENT_EXCHANGES * 2;
  const keepStart = Math.max(0, nonSystem.length - exchangesToKeep);
  const toKeep = [
    ...systemMessages,
    ...nonSystem.slice(keepStart),
  ];
  const toCompact = nonSystem.slice(0, keepStart);

  return { toCompact, toKeep };
}

/**
 * Replace session messages after compaction
 * Keeps system messages + compaction summary + recent messages
 */
export function replaceAfterCompaction(
  sessionId: string,
  compactionSummary: string,
  keptMessages: TrackedMessage[]
): void {
  const session = getSession(sessionId);

  const summaryMessage: TrackedMessage = {
    role: "system",
    content: `[COMPACTED CONTEXT]\n${compactionSummary}`,
    tokens: estimateTokens(compactionSummary),
    timestamp: Date.now(),
  };

  session.messages = [summaryMessage, ...keptMessages];
  session.totalTokens = session.messages.reduce((sum, m) => sum + m.tokens, 0);
  session.compactionCount += 1;

  logger.info(
    {
      sessionId,
      newTokenCount: session.totalTokens,
      compactionCount: session.compactionCount,
    },
    "Session compacted successfully"
  );
}

/**
 * Get session usage stats
 */
export function getSessionStats(sessionId: string): {
  totalTokens: number;
  messageCount: number;
  usage: number;
  compactionCount: number;
} | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  return {
    totalTokens: session.totalTokens,
    messageCount: session.messages.length,
    usage: session.totalTokens / session.contextWindow,
    compactionCount: session.compactionCount,
  };
}

/**
 * Clear a session
 */
export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/**
 * Get all active session IDs
 */
export function getActiveSessions(): string[] {
  return Array.from(sessions.keys());
}
