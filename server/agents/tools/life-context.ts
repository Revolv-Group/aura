/**
 * Life Context Tool
 *
 * Assembles a summary of current life data for agent awareness:
 * - Today's health entry (sleep, energy, mood, workout)
 * - Today's nutrition totals (calories, protein, carbs, fats)
 * - Today's day record (top 3 outcomes, one thing to ship, primary venture)
 * - Recent task completion rate (last 7 days)
 *
 * Results are cached for 15 minutes to avoid repeated DB queries.
 */

import { storage } from "../../storage";
import { logger } from "../../logger";

// In-memory cache with TTL
const cache = new Map<string, { data: string; expiresAt: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

export async function buildLifeContext(): Promise<string> {
  const cacheKey = "life-context";
  const now = Date.now();

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  try {
    const today = formatDate(new Date());
    const sevenDaysAgo = formatDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

    // Fetch all data in parallel
    const [dayRecord, healthEntries, nutritionEntries, allTasks] = await Promise.all([
      storage.getDay(today),
      storage.getHealthEntries({ dateGte: today, dateLte: today }),
      storage.getNutritionEntries({ date: today }),
      storage.getTasks({}),
    ]);

    const sections: string[] = [];
    sections.push(`## Life Context (${today})`);

    // Health
    const health = healthEntries[0];
    if (health) {
      sections.push(`### Health`);
      const healthLines: string[] = [];
      if (health.sleepHours) healthLines.push(`Sleep: ${health.sleepHours}h (${health.sleepQuality || "n/a"})`);
      if (health.energyLevel) healthLines.push(`Energy: ${health.energyLevel}/5`);
      if (health.mood) healthLines.push(`Mood: ${health.mood}`);
      if (health.stressLevel) healthLines.push(`Stress: ${health.stressLevel}`);
      if (health.workoutDone !== undefined) {
        healthLines.push(
          health.workoutDone
            ? `Workout: ${health.workoutType || "done"} (${health.workoutDurationMin || "?"}min)`
            : "Workout: not done"
        );
      }
      if (health.steps) healthLines.push(`Steps: ${health.steps.toLocaleString()}`);
      if (health.weightKg) healthLines.push(`Weight: ${health.weightKg}kg`);
      sections.push(healthLines.join(" | "));
    } else {
      sections.push("### Health\nNo health data logged today.");
    }

    // Nutrition
    if (nutritionEntries.length > 0) {
      sections.push(`### Nutrition (${nutritionEntries.length} meals logged)`);
      const totals = nutritionEntries.reduce(
        (acc, e) => ({
          calories: acc.calories + (e.calories || 0),
          protein: acc.protein + (e.proteinG || 0),
          carbs: acc.carbs + (e.carbsG || 0),
          fats: acc.fats + (e.fatsG || 0),
        }),
        { calories: 0, protein: 0, carbs: 0, fats: 0 }
      );
      sections.push(
        `Totals: ${Math.round(totals.calories)} cal | ${Math.round(totals.protein)}g protein | ${Math.round(totals.carbs)}g carbs | ${Math.round(totals.fats)}g fats`
      );
    } else {
      sections.push("### Nutrition\nNo meals logged today.");
    }

    // Day record
    if (dayRecord) {
      sections.push("### Today's Plan");
      const top3 = (dayRecord.top3Outcomes as any[]) || [];
      if (top3.length > 0) {
        const outcomeLines = top3.map(
          (o: any, i: number) => `${i + 1}. ${o.completed ? "[x]" : "[ ]"} ${o.outcome || o.text || o}`
        );
        sections.push("Top 3 Outcomes:\n" + outcomeLines.join("\n"));
      }
      if (dayRecord.oneThingToShip) {
        sections.push(`One thing to ship: ${dayRecord.oneThingToShip}`);
      }
      if (dayRecord.mood) {
        sections.push(`Day mood: ${dayRecord.mood}`);
      }
      if (dayRecord.morningRituals) {
        const rituals = dayRecord.morningRituals as Record<string, any>;
        const completed = Object.entries(rituals)
          .filter(([, v]) => v === true || (typeof v === "number" && v > 0))
          .map(([k]) => k);
        if (completed.length > 0) {
          sections.push(`Morning rituals done: ${completed.join(", ")}`);
        }
      }
    } else {
      sections.push("### Today's Plan\nNo day record created yet.");
    }

    // Task completion rate (last 7 days)
    const recentTasks = allTasks.filter((t: any) => {
      if (!t.completedAt) return false;
      const completed = formatDate(new Date(t.completedAt));
      return completed >= sevenDaysAgo && completed <= today;
    });
    const totalRecent = allTasks.filter((t: any) => {
      const created = formatDate(new Date(t.createdAt));
      return created >= sevenDaysAgo && created <= today;
    });

    sections.push("### Task Velocity (7 days)");
    sections.push(
      `Completed: ${recentTasks.length} tasks` +
        (totalRecent.length > 0
          ? ` | Completion rate: ${Math.round((recentTasks.length / totalRecent.length) * 100)}%`
          : "")
    );

    const result = sections.join("\n\n");

    // Cache the result
    cache.set(cacheKey, { data: result, expiresAt: now + CACHE_TTL_MS });

    return result;
  } catch (error) {
    logger.error({ error }, "Failed to build life context");
    return "Life context unavailable — could not fetch current data.";
  }
}
