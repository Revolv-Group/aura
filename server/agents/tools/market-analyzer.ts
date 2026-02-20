/**
 * Market Analyzer Tool
 *
 * Market sizing (TAM/SAM/SOM), competitor analysis, and SWOT
 * using web research + LLM synthesis.
 */

import * as modelManager from "../../model-manager";
import { logger } from "../../logger";
import { deepResearch, quickSearch } from "./web-research";
import type { AgentToolResult } from "../types";

// ============================================================================
// TAM/SAM/SOM
// ============================================================================

export async function marketSizing(
  market: string,
  product: string,
  geography?: string
): Promise<AgentToolResult> {
  const marketResearch = await deepResearch(
    `${market} market size revenue TAM ${geography || "global"} 2024 2025`,
    "market"
  );

  const marketData = JSON.parse(marketResearch.result);

  const { response } = await modelManager.chatCompletion(
    {
      messages: [
        {
          role: "system",
          content: `You are a market sizing expert. Using the research provided, estimate TAM, SAM, and SOM for the product/service.

Output format (JSON):
{
  "tam": { "value": "$X", "reasoning": "..." },
  "sam": { "value": "$X", "reasoning": "..." },
  "som": { "value": "$X", "reasoning": "..." },
  "growthRate": "X% CAGR",
  "keyDrivers": ["..."],
  "risks": ["..."],
  "confidence": "low|medium|high",
  "methodology": "..."
}

Be realistic. If data is insufficient, note low confidence.`,
        },
        {
          role: "user",
          content: `Market: ${market}\nProduct/Service: ${product}\nGeography: ${geography || "Global"}\n\nResearch:\n${marketData.analysis}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    },
    "complex"
  );

  const content = response.choices[0]?.message?.content || "{}";

  return {
    result: JSON.stringify(
      {
        analysisType: "market_sizing",
        market,
        product,
        geography: geography || "Global",
        sizing: content,
        sources: marketData.sources,
      },
      null,
      2
    ),
  };
}

// ============================================================================
// COMPETITOR ANALYSIS
// ============================================================================

export async function competitorAnalysis(
  market: string,
  competitors?: string[]
): Promise<AgentToolResult> {
  const searchQuery = competitors?.length
    ? `${competitors.join(" vs ")} comparison features pricing`
    : `${market} top competitors companies market leaders`;

  const research = await deepResearch(searchQuery, "competitive");
  const researchData = JSON.parse(research.result);

  const { response } = await modelManager.chatCompletion(
    {
      messages: [
        {
          role: "system",
          content: `You are a competitive intelligence analyst. Analyze the competitors in this market.

Output format (JSON):
{
  "competitors": [
    {
      "name": "...",
      "description": "...",
      "strengths": ["..."],
      "weaknesses": ["..."],
      "pricing": "...",
      "marketShare": "...",
      "differentiation": "..."
    }
  ],
  "marketDynamics": "...",
  "opportunities": ["..."],
  "threats": ["..."],
  "recommendation": "..."
}

Be specific and data-driven where possible.`,
        },
        {
          role: "user",
          content: `Market: ${market}\n${competitors?.length ? `Known competitors: ${competitors.join(", ")}` : ""}\n\nResearch:\n${researchData.analysis}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 3000,
    },
    "complex"
  );

  const content = response.choices[0]?.message?.content || "{}";

  return {
    result: JSON.stringify(
      {
        analysisType: "competitor_analysis",
        market,
        analysis: content,
        sources: researchData.sources,
      },
      null,
      2
    ),
  };
}

// ============================================================================
// SWOT ANALYSIS
// ============================================================================

export async function swotAnalysis(
  subject: string,
  context?: string
): Promise<AgentToolResult> {
  const research = await deepResearch(
    `${subject} strengths weaknesses opportunities threats market analysis`,
    "general"
  );
  const researchData = JSON.parse(research.result);

  const { response } = await modelManager.chatCompletion(
    {
      messages: [
        {
          role: "system",
          content: `You are a strategic analyst. Create a SWOT analysis.

Output format (JSON):
{
  "strengths": [{ "point": "...", "impact": "high|medium|low" }],
  "weaknesses": [{ "point": "...", "impact": "high|medium|low" }],
  "opportunities": [{ "point": "...", "impact": "high|medium|low", "timeframe": "short|medium|long" }],
  "threats": [{ "point": "...", "impact": "high|medium|low", "likelihood": "high|medium|low" }],
  "strategicImplications": "...",
  "recommendedActions": ["..."]
}

Be specific and actionable.`,
        },
        {
          role: "user",
          content: `Subject: ${subject}\n${context ? `Additional context: ${context}` : ""}\n\nResearch:\n${researchData.analysis}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 2500,
    },
    "complex"
  );

  const content = response.choices[0]?.message?.content || "{}";

  return {
    result: JSON.stringify(
      {
        analysisType: "swot",
        subject,
        swot: content,
        sources: researchData.sources,
      },
      null,
      2
    ),
  };
}

export async function marketValidation(
  idea: string,
  targetAudience?: string
): Promise<AgentToolResult> {
  const searchResults = await quickSearch(
    `${idea} market demand ${targetAudience || ""} alternatives`
  );
  const searchData = JSON.parse(searchResults.result);

  const { response } = await modelManager.chatCompletion(
    {
      messages: [
        {
          role: "system",
          content: `You are a market validation expert. Assess whether this product idea shows market fit signals.

Output format (JSON):
{
  "verdict": "promising|uncertain|weak",
  "demandSignals": ["..."],
  "existingAlternatives": ["..."],
  "gaps": ["..."],
  "targetAudienceInsights": "...",
  "suggestedNextSteps": ["..."],
  "confidence": "low|medium|high"
}`,
        },
        {
          role: "user",
          content: `Idea: ${idea}\nTarget audience: ${targetAudience || "Not specified"}\n\nSearch results:\n${JSON.stringify(searchData.results, null, 2)}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    },
    "complex"
  );

  const content = response.choices[0]?.message?.content || "{}";

  return {
    result: JSON.stringify(
      {
        analysisType: "market_validation",
        idea,
        targetAudience: targetAudience || "Not specified",
        validation: content,
        sources: searchData.results?.map((r: any) => ({ title: r.title, url: r.url })) || [],
      },
      null,
      2
    ),
  };
}
