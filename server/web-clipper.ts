/**
 * Web Clipper - URL content extraction utility
 *
 * Fetches web pages, extracts readable content using Mozilla Readability,
 * and returns clean markdown for storage in the Knowledge Hub.
 */

import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { logger } from "./logger";

export interface ClipResult {
  title: string;
  body: string;
  metadata: {
    sourceUrl: string;
    clippedAt: string;
    siteName?: string;
    byline?: string;
    excerpt?: string;
    wordCount: number;
  };
}

/**
 * Fetch a URL and extract readable content as markdown
 */
export async function clipUrl(url: string): Promise<ClipResult> {
  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  // Fetch the page
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; SB-OS/1.0; +https://sbos.app)",
      "Accept": "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();

  // Parse with JSDOM + Readability
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.textContent?.trim()) {
    throw new Error("Could not extract readable content from URL");
  }

  // Convert HTML content to simple markdown
  const body = htmlToMarkdown(article.content || article.textContent);

  const title = article.title || parsedUrl.hostname;
  const wordCount = body.split(/\s+/).length;

  logger.info({ url, title, wordCount }, "Clipped URL successfully");

  return {
    title,
    body,
    metadata: {
      sourceUrl: url,
      clippedAt: new Date().toISOString(),
      siteName: article.siteName || undefined,
      byline: article.byline || undefined,
      excerpt: article.excerpt || undefined,
      wordCount,
    },
  };
}

/**
 * Convert simple HTML to markdown-ish text
 */
function htmlToMarkdown(html: string): string {
  return html
    // Headers
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n")
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n\n")
    .replace(/<h5[^>]*>(.*?)<\/h5>/gi, "##### $1\n\n")
    .replace(/<h6[^>]*>(.*?)<\/h6>/gi, "###### $1\n\n")
    // Bold and italic
    .replace(/<(strong|b)[^>]*>(.*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>(.*?)<\/\1>/gi, "*$2*")
    // Links
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
    // Lists
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<\/?[uo]l[^>]*>/gi, "\n")
    // Paragraphs and breaks
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n")
    .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, "> $1\n\n")
    // Code
    .replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "```\n$1\n```\n\n")
    // Strip remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Clean up whitespace
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
