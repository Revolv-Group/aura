/**
 * Settings Routes
 * User preferences, morning ritual, AI settings, integrations, categories, profile
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import { insertUserPreferencesSchema, insertCustomCategorySchema } from "@shared/schema";
import { getAllIntegrationStatuses, getIntegrationStatus } from "../integrations";
import { z } from "zod";
import { DEFAULT_USER_ID } from "./constants";

const router = Router();

// ============================================================================
// USER PREFERENCES
// ============================================================================

// Get user preferences
router.get("/preferences", async (req: Request, res: Response) => {
  try {
    const prefs = await storage.getUserPreferences(DEFAULT_USER_ID);

    // Return default preferences if none exist
    if (!prefs) {
      res.json({
        userId: DEFAULT_USER_ID,
        theme: "system",
        morningRitualConfig: null,
        notificationSettings: null,
      });
      return;
    }

    res.json(prefs);
  } catch (error) {
    logger.error({ error }, "Error fetching user preferences");
    res.status(500).json({ error: "Failed to fetch preferences" });
  }
});

// Update user preferences
router.patch("/preferences", async (req: Request, res: Response) => {
  try {
    const updates = insertUserPreferencesSchema.partial().parse(req.body);
    const prefs = await storage.upsertUserPreferences(DEFAULT_USER_ID, updates);
    res.json(prefs);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid preferences data", details: error.errors });
    } else {
      logger.error({ error }, "Error updating user preferences");
      res.status(500).json({ error: "Failed to update preferences" });
    }
  }
});

// ============================================================================
// MORNING RITUAL CONFIG
// ============================================================================

// Get morning ritual config
router.get("/morning-ritual", async (req: Request, res: Response) => {
  try {
    const prefs = await storage.getUserPreferences(DEFAULT_USER_ID);

    // Return default config if none exists
    if (!prefs?.morningRitualConfig) {
      const defaultConfig = {
        habits: [
          { key: "press_ups", label: "Press-ups", icon: "Dumbbell", hasCount: true, countLabel: "reps", defaultCount: 50, enabled: true },
          { key: "squats", label: "Squats", icon: "Dumbbell", hasCount: true, countLabel: "reps", defaultCount: 50, enabled: true },
          { key: "supplements", label: "Supplements", icon: "Pill", hasCount: false, enabled: true },
          { key: "water", label: "Drink 500ml Water", icon: "Droplets", hasCount: true, countLabel: "ml", defaultCount: 500, enabled: true },
        ],
      };
      res.json(defaultConfig);
      return;
    }

    res.json(prefs.morningRitualConfig);
  } catch (error) {
    logger.error({ error }, "Error fetching morning ritual config");
    res.status(500).json({ error: "Failed to fetch morning ritual config" });
  }
});

// Update morning ritual config
router.patch("/morning-ritual", async (req: Request, res: Response) => {
  try {
    const morningRitualConfig = req.body;

    const prefs = await storage.upsertUserPreferences(DEFAULT_USER_ID, { morningRitualConfig });
    res.json(prefs.morningRitualConfig);
  } catch (error) {
    logger.error({ error }, "Error updating morning ritual config");
    res.status(500).json({ error: "Failed to update morning ritual config" });
  }
});

// ============================================================================
// AI ASSISTANT SETTINGS
// ============================================================================

// Get AI assistant settings
router.get("/ai", async (req: Request, res: Response) => {
  try {
    const prefs = await storage.getUserPreferences(DEFAULT_USER_ID);
    res.json({
      model: prefs?.aiModel || "openai/gpt-4o",
      customInstructions: prefs?.aiInstructions || "",
      temperature: prefs?.aiTemperature ?? 0.7,
      maxTokens: prefs?.aiMaxTokens ?? 4096,
      streamResponses: prefs?.aiStreamResponses ?? true,
      aiContext: prefs?.aiContext || {
        userName: "",
        role: "",
        goals: [],
        preferences: ""
      }
    });
  } catch (error) {
    logger.error({ error }, "Error fetching AI settings");
    res.status(500).json({ error: "Failed to fetch AI settings" });
  }
});

// Update AI assistant settings
router.patch("/ai", async (req: Request, res: Response) => {
  try {
    const { model, customInstructions, temperature, maxTokens, streamResponses, aiContext } = req.body;
    const updates: any = {};

    if (model !== undefined) {
      updates.aiModel = model;
    }
    if (customInstructions !== undefined) {
      updates.aiInstructions = customInstructions;
    }
    if (temperature !== undefined) {
      updates.aiTemperature = temperature;
    }
    if (maxTokens !== undefined) {
      updates.aiMaxTokens = maxTokens;
    }
    if (streamResponses !== undefined) {
      updates.aiStreamResponses = streamResponses;
    }
    if (aiContext !== undefined) {
      updates.aiContext = aiContext;
    }

    const prefs = await storage.upsertUserPreferences(DEFAULT_USER_ID, updates);
    res.json({
      model: prefs.aiModel || "openai/gpt-4o",
      customInstructions: prefs.aiInstructions || "",
      temperature: prefs.aiTemperature ?? 0.7,
      maxTokens: prefs.aiMaxTokens ?? 4096,
      streamResponses: prefs.aiStreamResponses ?? true,
      aiContext: prefs.aiContext || {}
    });
  } catch (error) {
    logger.error({ error }, "Error updating AI settings");
    res.status(500).json({ error: "Failed to update AI settings" });
  }
});

// ============================================================================
// INTEGRATIONS STATUS
// ============================================================================

// Get all integration statuses
router.get("/integrations", async (req: Request, res: Response) => {
  try {
    const statuses = await getAllIntegrationStatuses();
    res.json(statuses);
  } catch (error) {
    logger.error({ error }, "Error fetching integration statuses");
    res.status(500).json({ error: "Failed to fetch integration statuses" });
  }
});

// Get specific integration status
router.get("/integrations/:name", async (req: Request, res: Response) => {
  try {
    const status = await getIntegrationStatus(req.params.name);
    if (!status) {
      return res.status(404).json({ error: "Integration not found" });
    }
    res.json(status);
  } catch (error) {
    logger.error({ error }, "Error fetching integration status");
    res.status(500).json({ error: "Failed to fetch integration status" });
  }
});

// ============================================================================
// CUSTOM CATEGORIES
// ============================================================================

// Get all categories (with optional type filter)
router.get("/categories", async (req: Request, res: Response) => {
  try {
    const filters = {
      type: req.query.type as string,
      enabled: req.query.enabled === "true" ? true : req.query.enabled === "false" ? false : undefined,
    };

    const cleanFilters = Object.fromEntries(
      Object.entries(filters).filter(([_, value]) => value !== undefined)
    );

    const categories = await storage.getCategories(cleanFilters);
    res.json(categories);
  } catch (error) {
    logger.error({ error }, "Error fetching categories");
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

// Get single category
router.get("/categories/:id", async (req: Request, res: Response) => {
  try {
    const category = await storage.getCategory(req.params.id);
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json(category);
  } catch (error) {
    logger.error({ error }, "Error fetching category");
    res.status(500).json({ error: "Failed to fetch category" });
  }
});

// Create category
router.post("/categories", async (req: Request, res: Response) => {
  try {
    const validatedData = insertCustomCategorySchema.parse(req.body);
    const category = await storage.createCategory(validatedData);
    res.status(201).json(category);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid category data", details: error.errors });
    } else {
      logger.error({ error }, "Error creating category");
      res.status(500).json({ error: "Failed to create category" });
    }
  }
});

// Update category
router.patch("/categories/:id", async (req: Request, res: Response) => {
  try {
    const updates = insertCustomCategorySchema.partial().parse(req.body);
    const category = await storage.updateCategory(req.params.id, updates);
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json(category);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid category data", details: error.errors });
    } else {
      logger.error({ error }, "Error updating category");
      res.status(500).json({ error: "Failed to update category" });
    }
  }
});

// Delete category
router.delete("/categories/:id", async (req: Request, res: Response) => {
  try {
    // Check if it's a default category (prevent deletion)
    const category = await storage.getCategory(req.params.id);
    if (category?.metadata?.isDefault) {
      return res.status(400).json({ error: "Cannot delete default categories" });
    }

    await storage.deleteCategory(req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting category");
    res.status(500).json({ error: "Failed to delete category" });
  }
});

// ============================================================================
// USER PROFILE
// ============================================================================

// Get user profile
router.get("/profile", async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(DEFAULT_USER_ID);

    if (!user) {
      // Return default profile (will be created on first save)
      res.json({
        id: DEFAULT_USER_ID,
        email: "user@sb-os.com",
        firstName: "",
        lastName: "",
        timezone: "Asia/Dubai",
        dateFormat: "yyyy-MM-dd",
        timeFormat: "24h",
        weekStartsOn: 0,
      });
      return;
    }

    res.json(user);
  } catch (error) {
    logger.error({ error }, "Error fetching user profile");
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// Update user profile
router.patch("/profile", async (req: Request, res: Response) => {
  try {
    // Get existing user first to preserve data not being updated
    const existingUser = await storage.getUser(DEFAULT_USER_ID);

    // Only include fields that are explicitly provided (not undefined)
    // This prevents overwriting existing data with NULL
    const updates: Record<string, any> = {
      id: DEFAULT_USER_ID,
    };

    // Only update fields that are explicitly provided in the request
    if (req.body.email !== undefined) updates.email = req.body.email;
    if (req.body.firstName !== undefined) updates.firstName = req.body.firstName;
    if (req.body.lastName !== undefined) updates.lastName = req.body.lastName;
    if (req.body.timezone !== undefined) updates.timezone = req.body.timezone;
    if (req.body.dateFormat !== undefined) updates.dateFormat = req.body.dateFormat;
    if (req.body.timeFormat !== undefined) updates.timeFormat = req.body.timeFormat;
    if (req.body.weekStartsOn !== undefined) updates.weekStartsOn = req.body.weekStartsOn;

    // Ensure email is always set (use existing or default)
    if (!updates.email) {
      updates.email = existingUser?.email || "user@sb-os.com";
    }

    const user = await storage.upsertUser(updates);

    res.json(user);
  } catch (error) {
    logger.error({ error }, "Error updating user profile");
    res.status(500).json({ error: "Failed to update profile" });
  }
});

export default router;
