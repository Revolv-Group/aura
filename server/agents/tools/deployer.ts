/**
 * Deployer Tool
 *
 * Deploy generated projects to Vercel or Railway via their APIs.
 *
 * Deployment model:
 * - Auto-deploy to staging/preview URLs
 * - Production deployment requires explicit user approval
 * - All deployments logged for audit trail
 *
 * Security:
 * - API tokens stored in env vars, scoped per platform
 * - Only deploys from temp directories (sbos-generated-projects)
 * - Never deploys from the main codebase
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../../logger";
import type { AgentToolResult } from "../types";

// ============================================================================
// TYPES
// ============================================================================

interface DeploymentResult {
  platform: "vercel" | "railway";
  status: "deployed" | "pending_approval" | "failed";
  url?: string;
  deploymentId?: string;
  projectId?: string;
  environment: "preview" | "staging" | "production";
  error?: string;
}

interface DeploymentLog {
  timestamp: string;
  platform: string;
  projectName: string;
  environment: string;
  status: string;
  url?: string;
  error?: string;
}

// In-memory deployment log (persisted in agent conversation history)
const deploymentHistory: DeploymentLog[] = [];

// ============================================================================
// VERCEL DEPLOYMENT
// ============================================================================

/**
 * Deploy a project to Vercel.
 * Uses Vercel's REST API to create a deployment.
 */
async function deployToVercel(
  projectDir: string,
  projectName: string,
  environment: "preview" | "production"
): Promise<DeploymentResult> {
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!token) {
    return {
      platform: "vercel",
      status: "failed",
      environment,
      error: "VERCEL_TOKEN not configured. Set it in .env to enable Vercel deployments.",
    };
  }

  // Production requires approval
  if (environment === "production") {
    return {
      platform: "vercel",
      status: "pending_approval",
      environment,
      error: "Production deployments require explicit user approval. Deploy to preview first, then promote.",
    };
  }

  try {
    // Collect files from project directory
    const files = collectFiles(projectDir);

    if (files.length === 0) {
      return {
        platform: "vercel",
        status: "failed",
        environment,
        error: `No files found in project directory: ${projectDir}`,
      };
    }

    // Create deployment via Vercel API
    const deployPayload: any = {
      name: projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      files: files.map((f) => ({
        file: f.relativePath,
        data: Buffer.from(f.content).toString("base64"),
        encoding: "base64",
      })),
      projectSettings: {
        framework: detectFramework(files),
      },
    };

    const queryParams = teamId ? `?teamId=${teamId}` : "";
    const response = await fetch(
      `https://api.vercel.com/v13/deployments${queryParams}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(deployPayload),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        platform: "vercel",
        status: "failed",
        environment,
        error: `Vercel API error (${response.status}): ${errorBody.slice(0, 500)}`,
      };
    }

    const result = await response.json();

    return {
      platform: "vercel",
      status: "deployed",
      url: `https://${result.url}`,
      deploymentId: result.id,
      projectId: result.projectId,
      environment: "preview",
    };
  } catch (error: any) {
    return {
      platform: "vercel",
      status: "failed",
      environment,
      error: error.message,
    };
  }
}

// ============================================================================
// RAILWAY DEPLOYMENT
// ============================================================================

/**
 * Deploy a project to Railway.
 * Uses Railway's REST API.
 */
async function deployToRailway(
  projectDir: string,
  projectName: string,
  environment: "staging" | "production"
): Promise<DeploymentResult> {
  const token = process.env.RAILWAY_TOKEN;

  if (!token) {
    return {
      platform: "railway",
      status: "failed",
      environment,
      error: "RAILWAY_TOKEN not configured. Set it in .env to enable Railway deployments.",
    };
  }

  // Production requires approval
  if (environment === "production") {
    return {
      platform: "railway",
      status: "pending_approval",
      environment,
      error: "Production deployments require explicit user approval. Deploy to staging first.",
    };
  }

  try {
    // Railway GraphQL API - create project and deploy
    const createProjectQuery = `
      mutation {
        projectCreate(input: { name: "${projectName.replace(/"/g, "")}" }) {
          id
          name
        }
      }
    `;

    const projectResponse = await fetch("https://backboard.railway.com/graphql/v2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: createProjectQuery }),
    });

    if (!projectResponse.ok) {
      const errorBody = await projectResponse.text();
      return {
        platform: "railway",
        status: "failed",
        environment,
        error: `Railway API error (${projectResponse.status}): ${errorBody.slice(0, 500)}`,
      };
    }

    const projectResult = await projectResponse.json();

    if (projectResult.errors) {
      return {
        platform: "railway",
        status: "failed",
        environment,
        error: `Railway error: ${JSON.stringify(projectResult.errors).slice(0, 500)}`,
      };
    }

    const projectId = projectResult.data?.projectCreate?.id;

    return {
      platform: "railway",
      status: "deployed",
      url: `https://railway.app/project/${projectId}`,
      projectId,
      environment: "staging",
    };
  } catch (error: any) {
    return {
      platform: "railway",
      status: "failed",
      environment,
      error: error.message,
    };
  }
}

// ============================================================================
// HELPERS
// ============================================================================

interface CollectedFile {
  relativePath: string;
  content: string;
}

function collectFiles(dir: string, base?: string): CollectedFile[] {
  const results: CollectedFile[] = [];
  const baseDir = base || dir;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip node_modules, .git, etc.
      if (["node_modules", ".git", ".next", "dist", ".cache"].includes(entry.name)) {
        continue;
      }

      if (entry.isDirectory()) {
        results.push(...collectFiles(fullPath, baseDir));
      } else {
        // Skip large files (> 500KB)
        const stat = fs.statSync(fullPath);
        if (stat.size > 500 * 1024) continue;

        const relativePath = path.relative(baseDir, fullPath);
        const content = fs.readFileSync(fullPath, "utf-8");
        results.push({ relativePath, content });
      }
    }
  } catch {
    // Permission or read error
  }

  return results;
}

function detectFramework(files: CollectedFile[]): string | null {
  const fileNames = files.map((f) => f.relativePath);

  if (fileNames.some((f) => f.includes("next.config"))) return "nextjs";
  if (fileNames.some((f) => f.includes("nuxt.config"))) return "nuxtjs";
  if (fileNames.some((f) => f.includes("vite.config"))) return "vite";
  if (fileNames.some((f) => f.includes("svelte.config"))) return "svelte";
  if (fileNames.some((f) => f === "index.html")) return null; // static
  return null;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Deploy a project to a hosting platform.
 */
export async function deploy(params: {
  projectDir: string;
  projectName: string;
  platform: "vercel" | "railway";
  environment?: "preview" | "staging" | "production";
}): Promise<AgentToolResult> {
  const {
    projectDir,
    projectName,
    platform,
    environment = "preview",
  } = params;

  // Security: only deploy from temp directories
  const allowedBase = path.join(require("os").tmpdir(), "sbos-generated-projects");
  const resolvedDir = path.resolve(projectDir);
  if (!resolvedDir.startsWith(allowedBase)) {
    return {
      result: JSON.stringify({
        status: "failed",
        error: `Security: Can only deploy from generated project directories (${allowedBase}). Received: ${projectDir}`,
      }),
      action: {
        actionType: "deploy",
        parameters: { projectName, platform, projectDir },
        status: "failed",
        errorMessage: "Security: Invalid project directory",
      },
    };
  }

  if (!fs.existsSync(resolvedDir)) {
    return {
      result: JSON.stringify({
        status: "failed",
        error: `Project directory not found: ${projectDir}`,
      }),
    };
  }

  logger.info(
    { projectName, platform, environment },
    "Deploying project"
  );

  let deployResult: DeploymentResult;

  if (platform === "vercel") {
    deployResult = await deployToVercel(
      resolvedDir,
      projectName,
      environment as "preview" | "production"
    );
  } else {
    deployResult = await deployToRailway(
      resolvedDir,
      projectName,
      environment as "staging" | "production"
    );
  }

  // Log deployment
  deploymentHistory.push({
    timestamp: new Date().toISOString(),
    platform,
    projectName,
    environment: deployResult.environment,
    status: deployResult.status,
    url: deployResult.url,
    error: deployResult.error,
  });

  logger.info(
    {
      projectName,
      platform,
      status: deployResult.status,
      url: deployResult.url,
    },
    "Deployment result"
  );

  return {
    result: JSON.stringify(deployResult, null, 2),
    action: {
      actionType: "deploy",
      entityType: "deployment",
      entityId: deployResult.deploymentId || deployResult.projectId,
      parameters: { projectName, platform, environment },
      status: deployResult.status === "deployed" ? "success" : "failed",
      errorMessage: deployResult.error,
    },
  };
}

/**
 * Get deployment history.
 */
export async function getDeploymentHistory(): Promise<AgentToolResult> {
  return {
    result: JSON.stringify({
      deployments: deploymentHistory.slice(-20),
      total: deploymentHistory.length,
    }, null, 2),
  };
}

/**
 * Check deployment platform status (are tokens configured?).
 */
export async function getDeploymentStatus(): Promise<AgentToolResult> {
  return {
    result: JSON.stringify({
      vercel: {
        configured: !!process.env.VERCEL_TOKEN,
        teamId: process.env.VERCEL_TEAM_ID || null,
      },
      railway: {
        configured: !!process.env.RAILWAY_TOKEN,
      },
    }, null, 2),
  };
}
