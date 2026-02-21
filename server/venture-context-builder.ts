import { storage } from "./storage";
import { logger } from "./logger";
import { hybridSearch } from "./vector-search";
import type { Venture, Project, Task, Doc, Phase, CaptureItem } from "@shared/schema";

/**
 * Venture Context Builder
 * Aggregates all relevant data for a venture to create context for AI agents
 */

export interface VentureContext {
  venture: Venture;
  projects: ProjectWithDetails[];
  recentTasks: Task[];
  pendingTasks: Task[];
  docs: Doc[];
  captures: CaptureItem[];
  summary: string;
  metadata: {
    projectCount: number;
    taskCount: number;
    docCount: number;
    pendingTaskCount: number;
    lastUpdated: Date;
  };
}

interface ProjectWithDetails extends Project {
  phases?: Phase[];
  taskCount?: number;
  completedTaskCount?: number;
}

/**
 * Build complete context for a venture
 */
export async function buildVentureContext(ventureId: string): Promise<VentureContext> {
  const startTime = Date.now();

  try {
    // Fetch all data in parallel for efficiency
    const [venture, projects, allTasks, docs, captures] = await Promise.all([
      storage.getVenture(ventureId),
      storage.getProjects({ ventureId }),
      storage.getTasks({ ventureId }),
      storage.getDocs({ ventureId }),
      storage.getCaptures({ ventureId, clarified: false }),
    ]);

    if (!venture) {
      throw new Error(`Venture not found: ${ventureId}`);
    }

    // Get phases for each project
    const projectsWithDetails: ProjectWithDetails[] = await Promise.all(
      projects.map(async (project: Project) => {
        const phases = await storage.getPhases({ projectId: project.id });
        const projectTasks = allTasks.filter((t: Task) => t.projectId === project.id);
        return {
          ...project,
          phases,
          taskCount: projectTasks.length,
          completedTaskCount: projectTasks.filter((t: Task) => t.status === 'completed').length,
        };
      })
    );

    // Separate tasks by status
    const pendingTasks = allTasks.filter((t: Task) =>
      t.status === 'todo' || t.status === 'in_progress'
    );
    const recentTasks = allTasks
      .sort((a: Task, b: Task) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 20);

    // Generate context summary
    const summary = generateContextSummary(venture, projectsWithDetails, pendingTasks, docs);

    const buildTime = Date.now() - startTime;
    logger.info({ ventureId, buildTimeMs: buildTime }, "Built venture context");

    return {
      venture,
      projects: projectsWithDetails,
      recentTasks,
      pendingTasks,
      docs,
      captures,
      summary,
      metadata: {
        projectCount: projects.length,
        taskCount: allTasks.length,
        docCount: docs.length,
        pendingTaskCount: pendingTasks.length,
        lastUpdated: new Date(),
      },
    };
  } catch (error) {
    logger.error({ ventureId, error }, "Failed to build venture context");
    throw error;
  }
}

/**
 * Generate a text summary of the venture context for AI consumption
 */
function generateContextSummary(
  venture: Venture,
  projects: ProjectWithDetails[],
  pendingTasks: Task[],
  docs: Doc[]
): string {
  const lines: string[] = [];

  // Venture overview
  lines.push(`## Venture: ${venture.name}`);
  if (venture.oneLiner) lines.push(`Description: ${venture.oneLiner}`);
  lines.push(`Status: ${venture.status}`);
  if (venture.domain) lines.push(`Domain: ${venture.domain}`);
  if (venture.notes) lines.push(`Notes: ${venture.notes}`);
  lines.push('');

  // Projects summary
  if (projects.length > 0) {
    lines.push(`## Projects (${projects.length})`);
    for (const project of projects) {
      const progress = project.taskCount && project.taskCount > 0
        ? Math.round((project.completedTaskCount || 0) / project.taskCount * 100)
        : 0;
      lines.push(`- **${project.name}** [${project.status}] - ${progress}% complete`);
      if (project.outcome) lines.push(`  Outcome: ${project.outcome}`);
      if (project.phases && project.phases.length > 0) {
        const activePhases = project.phases.filter(m => m.status !== 'completed');
        if (activePhases.length > 0) {
          lines.push(`  Active Phases: ${activePhases.map(m => m.name).join(', ')}`);
        }
      }
    }
    lines.push('');
  }

  // Pending tasks
  if (pendingTasks.length > 0) {
    lines.push(`## Pending Tasks (${pendingTasks.length})`);

    // Group by priority
    const p0Tasks = pendingTasks.filter(t => t.priority === 'P0');
    const p1Tasks = pendingTasks.filter(t => t.priority === 'P1');
    const otherTasks = pendingTasks.filter(t => t.priority !== 'P0' && t.priority !== 'P1');

    if (p0Tasks.length > 0) {
      lines.push('### Critical (P0)');
      p0Tasks.slice(0, 5).forEach(t => lines.push(`- ${t.title} [${t.status}]`));
    }
    if (p1Tasks.length > 0) {
      lines.push('### High Priority (P1)');
      p1Tasks.slice(0, 5).forEach(t => lines.push(`- ${t.title} [${t.status}]`));
    }
    if (otherTasks.length > 0) {
      lines.push('### Other Tasks');
      otherTasks.slice(0, 10).forEach(t => lines.push(`- ${t.title} [${t.status}]`));
    }
    lines.push('');
  }

  // Knowledge base summary
  if (docs.length > 0) {
    lines.push(`## Knowledge Base (${docs.length} documents)`);

    // Group by type
    const docsByType = docs.reduce((acc, doc) => {
      const type = doc.type || 'page';
      if (!acc[type]) acc[type] = [];
      acc[type].push(doc);
      return acc;
    }, {} as Record<string, Doc[]>);

    for (const [type, typeDocs] of Object.entries(docsByType)) {
      lines.push(`### ${type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')} (${typeDocs.length})`);
      typeDocs.slice(0, 5).forEach(d => lines.push(`- ${d.title}`));
    }
  }

  return lines.join('\n');
}

/**
 * Build context string optimized for AI prompt injection
 * Respects token limits by prioritizing important information
 */
export async function buildContextForPrompt(
  ventureId: string,
  maxTokens: number = 8000
): Promise<string> {
  const context = await buildVentureContext(ventureId);

  // Estimate ~4 characters per token (rough approximation)
  const maxChars = maxTokens * 4;

  let contextStr = context.summary;

  // If within budget, add more detail
  if (contextStr.length < maxChars * 0.7) {
    // Add doc snippets
    const activeDocs = context.docs.filter(d => d.status === 'active').slice(0, 10);
    if (activeDocs.length > 0) {
      contextStr += '\n\n## Document Excerpts\n';
      for (const doc of activeDocs) {
        if (contextStr.length > maxChars * 0.9) break;
        const excerpt = doc.body?.slice(0, 500) || '';
        if (excerpt) {
          contextStr += `\n### ${doc.title}\n${excerpt}${excerpt.length >= 500 ? '...' : ''}\n`;
        }
      }
    }
  }

  // Truncate if necessary
  if (contextStr.length > maxChars) {
    contextStr = contextStr.slice(0, maxChars - 100) + '\n\n[Context truncated due to length]';
  }

  return contextStr;
}

/**
 * Search venture docs for relevant content based on a query
 * Uses hybrid search (vector 70% + keyword 30%) via the RAG pipeline
 */
export async function searchVentureKnowledge(
  ventureId: string,
  query: string,
  limit: number = 5
): Promise<{ doc: Doc; relevance: number; excerpt: string }[]> {
  try {
    const results = await hybridSearch(query, { ventureId, limit });

    return results.map(r => ({
      doc: {
        id: r.id,
        title: r.title,
        type: r.metadata?.docType as string || 'page',
      } as unknown as Doc,
      relevance: r.similarity,
      excerpt: r.content?.slice(0, 300) || '',
    }));
  } catch (error) {
    logger.warn({ error, ventureId, query }, 'Hybrid search failed, falling back to keyword search');
    // Fallback to simple keyword search
    const docs = await storage.getDocs({ ventureId, status: 'active' });
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    return docs
      .map(doc => {
        let score = 0;
        for (const term of queryTerms) {
          if (doc.title.toLowerCase().includes(term)) score += 3;
          if ((doc.body || '').toLowerCase().includes(term)) score += 1;
        }
        return { doc, relevance: score, excerpt: doc.body?.slice(0, 200) || '' };
      })
      .filter(item => item.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
  }
}

/**
 * Get or build cached context for a venture
 */
export async function getCachedOrBuildContext(
  ventureId: string,
  refreshIfOlderThanHours: number = 24
): Promise<string> {
  try {
    // Try to get cached context
    const cached = await storage.getVentureContextCache(ventureId, 'full');

    if (cached && cached.validUntil && new Date(cached.validUntil) > new Date()) {
      logger.debug({ ventureId }, "Using cached venture context");
      return cached.content;
    }

    // Build fresh context
    logger.info({ ventureId }, "Building fresh venture context");
    const context = await buildContextForPrompt(ventureId);

    // Cache it (don't await - fire and forget to avoid blocking)
    const validUntil = new Date(Date.now() + refreshIfOlderThanHours * 60 * 60 * 1000);
    storage.upsertVentureContextCache({
      ventureId,
      contextType: 'full',
      content: context,
      tokenCount: Math.ceil(context.length / 4), // Rough estimate
      lastBuiltAt: new Date(),
      validUntil,
    }).catch(err => logger.warn({ ventureId, err }, "Failed to cache context (non-critical)"));

    return context;
  } catch (error) {
    logger.error({ ventureId, error }, "Failed to get/build venture context");
    // Return minimal context on error - don't make any more DB calls that could fail
    return `Venture context temporarily unavailable. Please try again.`;
  }
}
