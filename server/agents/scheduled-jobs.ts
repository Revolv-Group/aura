/**
 * Scheduled Jobs
 *
 * Predefined job handlers for agent scheduled execution.
 * Maps job names to execution logic — e.g., "daily_briefing" triggers
 * the Chief of Staff to generate and save a daily report.
 */

import { eq } from "drizzle-orm";
import { logger } from "../logger";
import { agents, agentConversations, type Agent } from "@shared/schema";
import { dailyBriefing, weeklySummary, ventureStatus } from "./tools/report-generator";
import { executeAgentChat } from "./agent-runtime";
import { getAllAgentActivity } from "./conversation-manager";
import { messageBus } from "./message-bus";

// Lazy DB
let db: any = null;
async function getDb() {
  if (!db) {
    const { storage } = await import("../storage");
    db = (storage as any).db;
  }
  return db;
}

// ============================================================================
// JOB HANDLER TYPE
// ============================================================================

export type ScheduledJobHandler = (
  agentId: string,
  agentSlug: string
) => Promise<void>;

// ============================================================================
// JOB REGISTRY
// ============================================================================

const jobHandlers = new Map<string, ScheduledJobHandler>();

/**
 * Register a job handler by name.
 */
export function registerJobHandler(name: string, handler: ScheduledJobHandler): void {
  jobHandlers.set(name, handler);
}

/**
 * Execute a scheduled job by name.
 */
export async function executeScheduledJob(
  agentId: string,
  agentSlug: string,
  jobName: string
): Promise<void> {
  const handler = jobHandlers.get(jobName);

  if (!handler) {
    // Fallback: treat the job name as a prompt and run it through the agent's chat
    logger.info(
      { agentSlug, jobName },
      "No specific handler found, executing as chat prompt"
    );
    await executeAgentChat(agentSlug, `Execute your scheduled task: ${jobName}`, "scheduler");
    return;
  }

  await handler(agentId, agentSlug);
}

// ============================================================================
// BUILT-IN JOB HANDLERS
// ============================================================================

/**
 * Daily Briefing — Chief of Staff generates morning briefing.
 * Gathers system-wide activity, tasks, and produces an actionable summary.
 */
registerJobHandler("daily_briefing", async (agentId: string, agentSlug: string) => {
  const database = await getDb();

  // Generate the briefing using the report tool
  const briefingResult = await dailyBriefing();
  const briefingData = JSON.parse(briefingResult.result);

  // Get recent agent activity for the briefing
  const agentActivity = await getAllAgentActivity(24);
  const activitySummary = agentActivity.length > 0
    ? `\n\n## Agent Activity (Last 24h)\n${agentActivity.map(
        (a) => `- **${a.agentName}**: ${a.messageCount} messages, last: "${a.lastMessage.slice(0, 100)}..."`
      ).join("\n")}`
    : "";

  // Have the agent synthesize the briefing with personality
  const prompt = `Generate your daily briefing for the founder. Here is the data:\n\n${briefingData.report}${activitySummary}\n\nPresent this as your daily briefing, with your personality and insights. Highlight what matters most today.`;

  const result = await executeAgentChat(agentSlug, prompt, "scheduler");

  // Broadcast to message bus so other agents can see the briefing
  messageBus.broadcast(agentId, `[Daily Briefing] ${result.response.slice(0, 500)}`);

  // Send to Telegram if configured
  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
    const chatIds = getAuthorizedChatIds();
    for (const chatId of chatIds) {
      await sendProactiveMessage("telegram", chatId, `Daily Briefing\n\n${result.response}`);
    }
  } catch {
    // Telegram not configured — skip
  }

  logger.info(
    { agentSlug, tokensUsed: result.tokensUsed },
    "Daily briefing generated"
  );
});

/**
 * Weekly Report — CMO generates weekly marketing/business report.
 */
registerJobHandler("weekly_report", async (agentId: string, agentSlug: string) => {
  const weeklyResult = await weeklySummary();
  const weeklyData = JSON.parse(weeklyResult.result);

  const prompt = `Generate your weekly report for the founder. Here is the data:\n\n${weeklyData.report}\n\nAnalyze from your perspective as CMO. Include marketing insights, growth recommendations, and strategic priorities for next week.`;

  const result = await executeAgentChat(agentSlug, prompt, "scheduler");

  messageBus.broadcast(agentId, `[Weekly Report] ${result.response.slice(0, 500)}`);

  // Send to Telegram if configured
  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
    const chatIds = getAuthorizedChatIds();
    for (const chatId of chatIds) {
      await sendProactiveMessage("telegram", chatId, `Weekly Report\n\n${result.response}`);
    }
  } catch {
    // Telegram not configured — skip
  }

  logger.info(
    { agentSlug, tokensUsed: result.tokensUsed },
    "Weekly report generated"
  );
});

/**
 * Campaign Review — CMO reviews ongoing campaigns/projects.
 */
registerJobHandler("campaign_review", async (agentId: string, agentSlug: string) => {
  const prompt = `Review the current state of all marketing-related projects and campaigns. Use your tools to check project status and task progress. Provide a brief assessment of what's working, what's not, and what needs attention.`;

  await executeAgentChat(agentSlug, prompt, "scheduler");

  logger.info({ agentSlug }, "Campaign review completed");
});

/**
 * Tech Review — CTO reviews technical projects and architecture.
 */
registerJobHandler("tech_review", async (agentId: string, agentSlug: string) => {
  const prompt = `Review the current state of all technical projects. Use your tools to check project status and identify any blocked or at-risk items. Provide technical recommendations and flag any architectural concerns.`;

  await executeAgentChat(agentSlug, prompt, "scheduler");

  logger.info({ agentSlug }, "Tech review completed");
});

/**
 * Venture Status — Generate status report for a specific venture.
 * This is triggered with extra context in the schedule JSONB.
 */
registerJobHandler("venture_status_report", async (agentId: string, agentSlug: string) => {
  const database = await getDb();

  // Get the agent to find venture scope
  const [agent] = await database
    .select()
    .from(agents)
    .where(eq(agents.id, agentId));

  if (agent?.ventureId) {
    const statusResult = await ventureStatus(agent.ventureId);
    const statusData = JSON.parse(statusResult.result);

    const prompt = `Here is a venture status report. Synthesize it with your insights:\n\n${statusData.report}`;
    await executeAgentChat(agentSlug, prompt, "scheduler");
  } else {
    await executeAgentChat(
      agentSlug,
      "Generate a status report across all ventures you have visibility into.",
      "scheduler"
    );
  }

  logger.info({ agentSlug }, "Venture status report completed");
});

/**
 * Memory Cleanup — Periodic cleanup of expired agent memories.
 */
registerJobHandler("memory_cleanup", async (agentId: string, agentSlug: string) => {
  const { cleanupExpiredMemories } = await import("./agent-memory-manager");
  const result = await cleanupExpiredMemories();

  logger.info({ agentSlug, deleted: result.deleted }, "Memory cleanup completed");
});

/**
 * Inbox Triage — Process unclarified captures and suggest actions.
 */
registerJobHandler("inbox_triage", async (agentId: string, agentSlug: string) => {
  const prompt = `Check the inbox for unclarified capture items. For each one, suggest whether it should be converted to a task, delegated to a specialist, or dismissed. List your recommendations.`;

  await executeAgentChat(agentSlug, prompt, "scheduler");

  logger.info({ agentSlug }, "Inbox triage completed");
});
