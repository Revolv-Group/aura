/**
 * Web Research Tool
 *
 * Multi-step web search and content analysis for agents.
 * Uses OpenRouter models to analyze and synthesize search results.
 */

import * as modelManager from "../../model-manager";
import { logger } from "../../logger";
import type { AgentToolResult } from "../types";

// ============================================================================
// SEARCH (via Brave Search API or fallback to model knowledge)
// ============================================================================

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Perform a web search. Uses Brave Search API if available,
 * otherwise falls back to the model's knowledge with a disclaimer.
 */
async function webSearch(query: string, maxResults: number = 5): Promise<SearchResult[]> {
  const braveApiKey = process.env.BRAVE_SEARCH_API_KEY;

  if (braveApiKey) {
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": braveApiKey,
        },
      });

      if (!res.ok) {
        logger.warn({ status: res.status }, "Brave Search API error, falling back");
        return modelFallbackSearch(query, maxResults);
      }

      const data = await res.json();
      const results = (data.web?.results || []).slice(0, maxResults);

      return results.map((r: any) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: r.description || "",
      }));
    } catch (error: any) {
      logger.warn({ error: error.message }, "Brave Search failed, falling back");
      return modelFallbackSearch(query, maxResults);
    }
  }

  return modelFallbackSearch(query, maxResults);
}

/**
 * Fallback: ask the model to provide search-like results from its knowledge.
 */
async function modelFallbackSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const { response } = await modelManager.chatCompletion(
    {
      messages: [
        {
          role: "system",
          content: "You are a research assistant. Provide the most relevant information you know about the query. Format as a JSON array of objects with title, url (use 'internal-knowledge' as URL), and snippet fields.",
        },
        {
          role: "user",
          content: `Research query: "${query}". Provide ${maxResults} relevant results as JSON array.`,
        },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    },
    "simple"
  );

  try {
    const content = response.choices[0]?.message?.content || "[]";
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]).slice(0, maxResults);
    }
  } catch {
    // Parse failed
  }

  return [
    {
      title: `Research on: ${query}`,
      url: "internal-knowledge",
      snippet: response.choices[0]?.message?.content?.slice(0, 300) || "No results found",
    },
  ];
}

// ============================================================================
// CONTENT EXTRACTION
// ============================================================================

/**
 * Fetch a URL and extract readable content.
 */
async function fetchAndExtract(url: string, fallbackSnippet: string): Promise<string> {
  if (url === "internal-knowledge") {
    return fallbackSnippet;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "SB-OS Research Agent/1.0",
        Accept: "text/html,text/plain",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return fallbackSnippet;

    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();

    return text.slice(0, 5000);
  } catch {
    return fallbackSnippet;
  }
}

// ============================================================================
// ANALYSIS
// ============================================================================

async function analyzeResults(
  query: string,
  results: Array<{ title: string; url: string; content: string }>,
  analysisType: string
): Promise<string> {
  const resultsContext = results
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content.slice(0, 1500)}`)
    .join("\n\n---\n\n");

  const analysisPrompts: Record<string, string> = {
    summary: "Provide a clear, structured summary of the findings. Use bullet points for key insights.",
    competitive: "Analyze from a competitive intelligence perspective. Identify key players, market positioning, strengths, weaknesses.",
    market: "Focus on market size, trends, growth potential, and key opportunities/threats.",
    technical: "Focus on technical details, architecture decisions, implementation approaches, and best practices.",
    general: "Synthesize the most important and relevant information. Highlight key takeaways.",
  };

  const prompt = analysisPrompts[analysisType] || analysisPrompts.general;

  const { response } = await modelManager.chatCompletion(
    {
      messages: [
        {
          role: "system",
          content: `You are a research analyst. ${prompt} Be concise but thorough. Cite sources by number [1], [2], etc.`,
        },
        {
          role: "user",
          content: `Research query: "${query}"\n\nSources:\n\n${resultsContext}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 3000,
    },
    "complex"
  );

  return response.choices[0]?.message?.content || "Unable to analyze results.";
}

// ============================================================================
// PUBLIC API
// ============================================================================

export async function quickSearch(query: string): Promise<AgentToolResult> {
  const results = await webSearch(query, 5);

  return {
    result: JSON.stringify(
      {
        query,
        results: results.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
        })),
      },
      null,
      2
    ),
  };
}

export async function deepResearch(
  query: string,
  analysisType: string = "general"
): Promise<AgentToolResult> {
  const searchResults = await webSearch(query, 5);

  if (searchResults.length === 0) {
    return { result: `No results found for: "${query}"` };
  }

  const enrichedResults = await Promise.all(
    searchResults.slice(0, 3).map(async (r) => ({
      title: r.title,
      url: r.url,
      content: await fetchAndExtract(r.url, r.snippet),
    }))
  );

  const analysis = await analyzeResults(query, enrichedResults, analysisType);

  return {
    result: JSON.stringify(
      {
        query,
        analysisType,
        analysis,
        sources: searchResults.map((r) => ({ title: r.title, url: r.url })),
      },
      null,
      2
    ),
  };
}

export async function structuredExtraction(
  query: string,
  extractionSchema: string
): Promise<AgentToolResult> {
  const searchResults = await webSearch(query, 5);

  const enrichedResults = await Promise.all(
    searchResults.slice(0, 3).map(async (r) => ({
      title: r.title,
      url: r.url,
      content: await fetchAndExtract(r.url, r.snippet),
    }))
  );

  const resultsContext = enrichedResults
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.content.slice(0, 1500)}`)
    .join("\n\n---\n\n");

  const { response } = await modelManager.chatCompletion(
    {
      messages: [
        {
          role: "system",
          content: `You are a data extraction specialist. Extract the requested information from the provided sources. Return ONLY valid JSON matching the requested schema. If data is not available, use null.`,
        },
        {
          role: "user",
          content: `Query: "${query}"\n\nExtraction schema: ${extractionSchema}\n\nSources:\n${resultsContext}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 3000,
    },
    "complex"
  );

  const extracted = response.choices[0]?.message?.content || "{}";

  return {
    result: JSON.stringify(
      {
        query,
        extracted,
        sources: searchResults.map((r) => ({ title: r.title, url: r.url })),
      },
      null,
      2
    ),
  };
}
