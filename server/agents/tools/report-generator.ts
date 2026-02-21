/**
 * Report Generator Tool
 *
 * Generate structured reports (daily briefings, weekly summaries,
 * status updates) using LLM synthesis of SB-OS data.
 */

import * as modelManager from "../../model-manager";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { buildLifeContext } from "./life-context";
import type { AgentToolResult } from "../types";

// ============================================================================
// REPORT TYPES
// ============================================================================

type ReportType = "daily_briefing" | "weekly_summary" | "venture_status" | "custom";

interface ReportOptions {
  type: ReportType;
  ventureId?: string;
  customPrompt?: string;
}

// ============================================================================
// DATA GATHERERS
// ============================================================================

async function gatherDailyBriefingData(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const sections: string[] = [];

  try {
    const allTasks = await storage.getTasks({});
    const todayTasks = allTasks.filter(
      (t: any) =>
        t.focusDate === today ||
        t.dueDate === today ||
        (t.status === "in_progress")
    );
    const overdue = allTasks.filter(
      (t: any) => t.dueDate && t.dueDate < today && !["done", "cancelled"].includes(t.status)
    );

    sections.push(`## Tasks Today (${todayTasks.length})`);
    for (const t of todayTasks.slice(0, 15)) {
      sections.push(`- [${t.priority || "P2"}] ${t.title} (${t.status})`);
    }

    if (overdue.length > 0) {
      sections.push(`\n## Overdue Tasks (${overdue.length})`);
      for (const t of overdue.slice(0, 10)) {
        sections.push(`- [${t.priority || "P2"}] ${t.title} — due ${t.dueDate}`);
      }
    }
  } catch {
    sections.push("## Tasks\nUnable to load tasks.");
  }

  try {
    const ventures = await storage.getVentures();
    sections.push(`\n## Active Ventures (${ventures.filter((v: any) => v.status !== "archived").length})`);
    for (const v of ventures.filter((v: any) => v.status !== "archived")) {
      sections.push(`- **${v.name}** (${v.status}) — ${v.domain}`);
    }
  } catch {
    sections.push("\n## Ventures\nUnable to load ventures.");
  }

  try {
    const captures = await storage.getCaptures();
    const unclarified = captures.filter((c: any) => !c.clarified);
    if (unclarified.length > 0) {
      sections.push(`\n## Inbox (${unclarified.length} unclarified)`);
      for (const c of unclarified.slice(0, 5)) {
        sections.push(`- ${c.title} (${c.type})`);
      }
    }
  } catch {
    // Silent
  }

  // Append life context (health, nutrition, day record)
  try {
    const lifeContext = await buildLifeContext();
    sections.push("\n" + lifeContext);
  } catch {
    // Non-critical
  }

  return sections.join("\n");
}

async function gatherWeeklySummaryData(): Promise<string> {
  const sections: string[] = [];
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);

  try {
    const allTasks = await storage.getTasks({});
    const completed = allTasks.filter(
      (t: any) =>
        t.status === "done" &&
        t.completedAt &&
        new Date(t.completedAt).toISOString().slice(0, 10) >= weekAgoStr
    );

    sections.push(`## Completed This Week (${completed.length})`);
    for (const t of completed.slice(0, 20)) {
      sections.push(`- ${t.title} (${t.priority || "P2"})`);
    }

    const inProgress = allTasks.filter((t: any) => t.status === "in_progress");
    sections.push(`\n## Currently In Progress (${inProgress.length})`);
    for (const t of inProgress.slice(0, 10)) {
      sections.push(`- ${t.title}`);
    }
  } catch {
    sections.push("## Tasks\nUnable to load tasks.");
  }

  try {
    const projects = await storage.getProjects({});
    const active = projects.filter((p: any) => p.status === "in_progress");
    sections.push(`\n## Active Projects (${active.length})`);
    for (const p of active.slice(0, 10)) {
      sections.push(`- **${p.name}** — ${p.category || "general"} (${p.priority || "P2"})`);
    }
  } catch {
    // Silent
  }

  return sections.join("\n");
}

async function gatherVentureStatusData(ventureId: string): Promise<string> {
  const sections: string[] = [];

  try {
    const venture = await storage.getVenture(ventureId);
    if (!venture) return "Venture not found.";

    sections.push(`# ${venture.name} Status Report`);
    sections.push(`Status: ${venture.status} | Domain: ${venture.domain}`);
    if (venture.oneLiner) sections.push(`Focus: ${venture.oneLiner}`);

    const projects = await storage.getProjects({ ventureId });
    sections.push(`\n## Projects (${projects.length})`);
    for (const p of projects) {
      sections.push(`- **${p.name}** — ${p.status} (${p.priority || "P2"})`);
      if (p.outcome) sections.push(`  Outcome: ${p.outcome}`);
    }

    const tasks = await storage.getTasks({ ventureId });
    const byStatus: Record<string, number> = {};
    for (const t of tasks) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    }

    sections.push(`\n## Task Distribution`);
    for (const [status, count] of Object.entries(byStatus)) {
      sections.push(`- ${status}: ${count}`);
    }
  } catch (error: any) {
    sections.push(`Error loading venture data: ${error.message}`);
  }

  return sections.join("\n");
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

async function generateReport(data: string, options: ReportOptions): Promise<string> {
  const reportPrompts: Record<ReportType, string> = {
    daily_briefing: `You are the Chief of Staff generating a daily briefing for the founder.
Create a concise, actionable briefing that:
- Highlights the most important items that need attention TODAY
- Flags any overdue or blocked items
- Suggests the top 3 priorities for the day
- Notes inbox items that need processing
Keep it under 500 words. Be direct and actionable.`,

    weekly_summary: `You are the Chief of Staff generating a weekly summary for the founder.
Create a structured weekly review that:
- Summarizes accomplishments this week
- Highlights progress on active projects
- Identifies blockers and risks
- Suggests focus areas for next week
Keep it under 800 words. Use data-driven observations.`,

    venture_status: `You are generating a venture status report.
Create a comprehensive status update that:
- Summarizes current state and momentum
- Highlights project progress and blockers
- Identifies risks and opportunities
- Recommends next actions
Keep it under 600 words.`,

    custom: options.customPrompt || "Summarize the provided data into a clear, actionable report.",
  };

  const { response } = await modelManager.chatCompletion(
    {
      messages: [
        { role: "system", content: reportPrompts[options.type] },
        { role: "user", content: `Here is the data to analyze:\n\n${data}` },
      ],
      temperature: 0.5,
      max_tokens: 2000,
    },
    "complex"
  );

  return response.choices[0]?.message?.content || "Unable to generate report.";
}

// ============================================================================
// PUBLIC API
// ============================================================================

export async function dailyBriefing(): Promise<AgentToolResult> {
  const data = await gatherDailyBriefingData();
  const report = await generateReport(data, { type: "daily_briefing" });

  return {
    result: JSON.stringify({
      reportType: "daily_briefing",
      date: new Date().toISOString().slice(0, 10),
      report,
    }, null, 2),
  };
}

export async function weeklySummary(): Promise<AgentToolResult> {
  const data = await gatherWeeklySummaryData();
  const report = await generateReport(data, { type: "weekly_summary" });

  return {
    result: JSON.stringify({
      reportType: "weekly_summary",
      date: new Date().toISOString().slice(0, 10),
      report,
    }, null, 2),
  };
}

export async function ventureStatus(ventureId: string): Promise<AgentToolResult> {
  const data = await gatherVentureStatusData(ventureId);
  const report = await generateReport(data, { type: "venture_status", ventureId });

  return {
    result: JSON.stringify({
      reportType: "venture_status",
      ventureId,
      date: new Date().toISOString().slice(0, 10),
      report,
    }, null, 2),
  };
}

export async function customReport(prompt: string, data?: string): Promise<AgentToolResult> {
  const reportData = data || await gatherDailyBriefingData();
  const report = await generateReport(reportData, { type: "custom", customPrompt: prompt });

  return {
    result: JSON.stringify({
      reportType: "custom",
      date: new Date().toISOString().slice(0, 10),
      report,
    }, null, 2),
  };
}
