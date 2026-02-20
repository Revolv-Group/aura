/**
 * Code Generator Tool
 *
 * Generates project scaffolds and code files using LLM.
 * Writes to a temp directory, validates output, returns file manifest.
 *
 * Supported templates:
 * - Next.js app (App Router)
 * - Express API
 * - Static landing page
 * - Custom (LLM generates from description)
 *
 * Security: All output goes to temp directories. Never writes to
 * the main codebase or system directories.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as modelManager from "../../model-manager";
import { logger } from "../../logger";
import type { AgentToolResult } from "../types";

// ============================================================================
// TEMP DIRECTORY MANAGEMENT
// ============================================================================

const PROJECTS_BASE = path.join(os.tmpdir(), "sbos-generated-projects");

function ensureProjectsDir(): void {
  if (!fs.existsSync(PROJECTS_BASE)) {
    fs.mkdirSync(PROJECTS_BASE, { recursive: true });
  }
}

function createProjectDir(projectName: string): string {
  ensureProjectsDir();
  const sanitized = projectName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);
  const timestamp = Date.now().toString(36);
  const dirName = `${sanitized}-${timestamp}`;
  const projectDir = path.join(PROJECTS_BASE, dirName);
  fs.mkdirSync(projectDir, { recursive: true });
  return projectDir;
}

// ============================================================================
// FILE GENERATION
// ============================================================================

interface GeneratedFile {
  path: string;
  content: string;
  language: string;
}

interface GenerationResult {
  projectDir: string;
  projectName: string;
  template: string;
  files: Array<{ path: string; language: string; size: number }>;
  instructions: string;
}

/**
 * Write generated files to the project directory.
 */
function writeFiles(projectDir: string, files: GeneratedFile[]): void {
  for (const file of files) {
    const fullPath = path.join(projectDir, file.path);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, file.content, "utf-8");
  }
}

// ============================================================================
// TEMPLATES
// ============================================================================

function getNextJsPrompt(projectName: string, description: string): string {
  return `Generate a Next.js 14 project (App Router) for: "${projectName}"

Description: ${description}

Generate these files:
1. package.json (with dependencies: next, react, react-dom, typescript, @types/react, @types/node, tailwindcss, postcss, autoprefixer)
2. tsconfig.json
3. tailwind.config.ts
4. postcss.config.js
5. next.config.js
6. app/layout.tsx (root layout with Tailwind)
7. app/page.tsx (main page with the core UI for this project)
8. app/globals.css (Tailwind imports + basic styles)
9. README.md (setup instructions)

For each file, output in this exact format:
---FILE: <filepath>---
<file content>
---END FILE---

Make the page.tsx functional and visually polished with Tailwind. Include real UI relevant to the project description, not placeholder text.`;
}

function getExpressApiPrompt(projectName: string, description: string): string {
  return `Generate an Express.js TypeScript API for: "${projectName}"

Description: ${description}

Generate these files:
1. package.json (with dependencies: express, typescript, @types/express, @types/node, ts-node, nodemon, cors, dotenv)
2. tsconfig.json
3. src/index.ts (main server with CORS, JSON parsing, error handling)
4. src/routes/index.ts (route registration)
5. src/routes/api.ts (API routes relevant to the project)
6. .env.example
7. README.md (setup instructions)

For each file, output in this exact format:
---FILE: <filepath>---
<file content>
---END FILE---

Make the API routes functional and relevant to the project description. Include proper TypeScript types and error handling.`;
}

function getLandingPagePrompt(projectName: string, description: string): string {
  return `Generate a modern landing page for: "${projectName}"

Description: ${description}

Generate these files:
1. index.html (complete HTML with inline Tailwind CDN, hero section, features, CTA, footer)
2. styles.css (any additional custom styles)
3. script.js (interactivity — smooth scroll, mobile nav toggle, form handling)
4. README.md (deployment instructions)

For each file, output in this exact format:
---FILE: <filepath>---
<file content>
---END FILE---

Make the landing page visually stunning with a modern design. Use real copy relevant to the project, not Lorem Ipsum.`;
}

function getCustomPrompt(projectName: string, description: string, techStack?: string): string {
  return `Generate a complete project for: "${projectName}"

Description: ${description}
${techStack ? `Tech stack: ${techStack}` : "Choose the most appropriate tech stack."}

Generate all necessary files for a working project. Include:
- Package/dependency file
- Configuration files
- Source code with the core functionality
- README.md with setup instructions

For each file, output in this exact format:
---FILE: <filepath>---
<file content>
---END FILE---

Make the code production-quality, well-structured, and functional. Include proper error handling and types.`;
}

// ============================================================================
// LLM GENERATION + PARSING
// ============================================================================

/**
 * Parse the LLM output into individual files.
 */
function parseGeneratedFiles(output: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const filePattern = /---FILE:\s*(.+?)---\n([\s\S]*?)---END FILE---/g;

  let match;
  while ((match = filePattern.exec(output)) !== null) {
    const filePath = match[1].trim();
    const content = match[2].trim();

    // Detect language from extension
    const ext = path.extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "typescript",
      ".js": "javascript",
      ".jsx": "javascript",
      ".json": "json",
      ".html": "html",
      ".css": "css",
      ".md": "markdown",
      ".yml": "yaml",
      ".yaml": "yaml",
      ".env": "env",
    };

    files.push({
      path: filePath,
      content,
      language: langMap[ext] || "text",
    });
  }

  return files;
}

/**
 * Generate a project using LLM.
 */
async function generateWithLLM(
  prompt: string,
  projectName: string,
  template: string
): Promise<GenerationResult> {
  const { response } = await modelManager.chatCompletion(
    {
      messages: [
        {
          role: "system",
          content:
            "You are an expert full-stack developer. Generate complete, production-quality project files. Follow the exact output format specified. Every file should be complete and functional — no placeholders, no TODO comments, no truncated code.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 8000,
    },
    "complex"
  );

  const content = response.choices[0]?.message?.content || "";
  const files = parseGeneratedFiles(content);

  if (files.length === 0) {
    throw new Error("No files generated. The LLM response did not contain valid file blocks.");
  }

  // Write to temp directory
  const projectDir = createProjectDir(projectName);
  writeFiles(projectDir, files);

  // Extract instructions from README if present
  const readme = files.find((f) => f.path.toLowerCase().includes("readme"));
  const instructions = readme?.content || "See the generated files for setup instructions.";

  return {
    projectDir,
    projectName,
    template,
    files: files.map((f) => ({
      path: f.path,
      language: f.language,
      size: f.content.length,
    })),
    instructions,
  };
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Generate a project scaffold.
 */
export async function generateProject(params: {
  projectName: string;
  description: string;
  template: "nextjs" | "express" | "landing" | "custom";
  techStack?: string;
}): Promise<AgentToolResult> {
  const { projectName, description, template, techStack } = params;

  logger.info(
    { projectName, template },
    "Generating project scaffold"
  );

  let prompt: string;
  switch (template) {
    case "nextjs":
      prompt = getNextJsPrompt(projectName, description);
      break;
    case "express":
      prompt = getExpressApiPrompt(projectName, description);
      break;
    case "landing":
      prompt = getLandingPagePrompt(projectName, description);
      break;
    case "custom":
      prompt = getCustomPrompt(projectName, description, techStack);
      break;
    default:
      prompt = getCustomPrompt(projectName, description, techStack);
  }

  try {
    const result = await generateWithLLM(prompt, projectName, template);

    logger.info(
      { projectName, template, files: result.files.length, dir: result.projectDir },
      "Project generated successfully"
    );

    return {
      result: JSON.stringify(
        {
          status: "success",
          projectDir: result.projectDir,
          projectName: result.projectName,
          template: result.template,
          filesGenerated: result.files.length,
          files: result.files,
          instructions: result.instructions.slice(0, 2000),
        },
        null,
        2
      ),
      action: {
        actionType: "code_generate",
        entityType: "project",
        parameters: { projectName, template },
        status: "success",
      },
    };
  } catch (error: any) {
    logger.error({ projectName, error: error.message }, "Project generation failed");
    return {
      result: JSON.stringify({
        status: "error",
        error: error.message,
        projectName,
        template,
      }),
      action: {
        actionType: "code_generate",
        parameters: { projectName, template },
        status: "failed",
        errorMessage: error.message,
      },
    };
  }
}

/**
 * Generate a single file or code snippet.
 */
export async function generateCode(params: {
  description: string;
  language: string;
  filename?: string;
}): Promise<AgentToolResult> {
  const { description, language, filename } = params;

  const { response } = await modelManager.chatCompletion(
    {
      messages: [
        {
          role: "system",
          content: `You are an expert ${language} developer. Generate production-quality code. Output ONLY the code, no explanations or markdown fences.`,
        },
        {
          role: "user",
          content: `Generate ${language} code for: ${description}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    },
    "complex"
  );

  const code = response.choices[0]?.message?.content || "";

  // Optionally write to temp file
  let filePath: string | undefined;
  if (filename) {
    ensureProjectsDir();
    filePath = path.join(PROJECTS_BASE, `snippet-${Date.now().toString(36)}`, filename);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, code, "utf-8");
  }

  return {
    result: JSON.stringify({
      status: "success",
      language,
      filename: filename || "snippet",
      code: code.slice(0, 5000),
      filePath,
      codeLength: code.length,
    }, null, 2),
  };
}

/**
 * List previously generated projects.
 */
export async function listGeneratedProjects(): Promise<AgentToolResult> {
  ensureProjectsDir();

  const entries = fs.readdirSync(PROJECTS_BASE, { withFileTypes: true });
  const projects = entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const projectDir = path.join(PROJECTS_BASE, e.name);
      const files = getAllFiles(projectDir);
      return {
        name: e.name,
        path: projectDir,
        fileCount: files.length,
        totalSize: files.reduce((sum, f) => sum + f.size, 0),
      };
    })
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(0, 20);

  return {
    result: JSON.stringify({ projects, baseDir: PROJECTS_BASE }, null, 2),
  };
}

function getAllFiles(dir: string): Array<{ path: string; size: number }> {
  const results: Array<{ path: string; size: number }> = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...getAllFiles(fullPath));
      } else {
        const stat = fs.statSync(fullPath);
        results.push({ path: fullPath, size: stat.size });
      }
    }
  } catch {
    // Permission error or deleted
  }
  return results;
}
