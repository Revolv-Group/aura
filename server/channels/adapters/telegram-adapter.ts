/**
 * Telegram Channel Adapter
 *
 * Connects to Telegram Bot API using Telegraf, routes messages
 * to the agent system via the channel manager.
 *
 * Features:
 * - Access control via AUTHORIZED_TELEGRAM_CHAT_IDS
 * - Rate limiting per chat
 * - Text + photo message handling
 * - Agent routing via @mentions
 * - Proactive message sending (for scheduled briefings)
 * - Webhook support for production
 */

import { Telegraf } from "telegraf";
import { logger } from "../../logger";
import { processIncomingMessage } from "../channel-manager";
import { storage } from "../../storage";
import type {
  ChannelAdapter,
  ChannelStatus,
  IncomingMessage,
  OutgoingMessage,
} from "../types";

// ============================================================================
// CONFIG
// ============================================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AUTHORIZED_CHAT_IDS = (process.env.AUTHORIZED_TELEGRAM_CHAT_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

// Rate limiting
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60000;
const chatRateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(chatId: string): boolean {
  const now = Date.now();
  const limit = chatRateLimits.get(chatId);

  if (!limit || now > limit.resetAt) {
    chatRateLimits.set(chatId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (limit.count >= RATE_LIMIT_MAX) {
    return false;
  }

  limit.count++;
  return true;
}

// Cleanup expired rate limits
setInterval(() => {
  const now = Date.now();
  const expired: string[] = [];
  chatRateLimits.forEach((limit, chatId) => {
    if (now > limit.resetAt) expired.push(chatId);
  });
  expired.forEach((chatId) => chatRateLimits.delete(chatId));
}, 5 * 60 * 1000);

// ============================================================================
// ADAPTER
// ============================================================================

class TelegramAdapter implements ChannelAdapter {
  platform = "telegram" as const;
  private bot: Telegraf | null = null;
  private connected = false;
  private startedAt: Date | null = null;
  private stats = {
    messagesReceived: 0,
    messagesSent: 0,
    errors: 0,
    lastError: null as string | null,
    lastActivity: null as Date | null,
  };

  async start(): Promise<void> {
    if (!BOT_TOKEN) {
      logger.warn("TELEGRAM_BOT_TOKEN not set — Telegram adapter will not start");
      return;
    }

    this.bot = new Telegraf(BOT_TOKEN);

    // ---- Access Control Middleware ----
    this.bot.use((ctx, next) => {
      const chatId = ctx.chat?.id.toString();

      if (AUTHORIZED_CHAT_IDS.length === 0) {
        if (process.env.NODE_ENV === "production") {
          logger.error("AUTHORIZED_TELEGRAM_CHAT_IDS not set in production — blocking all");
          return ctx.reply("Bot is not configured for access. Contact administrator.");
        }
        return next();
      }

      if (!chatId || !AUTHORIZED_CHAT_IDS.includes(chatId)) {
        logger.warn({ chatId }, "Unauthorized Telegram access attempt");
        return ctx.reply("Unauthorized. This is a private assistant.");
      }

      return next();
    });

    // ---- Rate Limiting Middleware ----
    this.bot.use((ctx, next) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return ctx.reply("Error: Unable to identify chat.");

      if (!checkRateLimit(chatId)) {
        return ctx.reply("You're sending messages too quickly. Please wait a moment.");
      }

      return next();
    });

    // ---- /start Command ----
    this.bot.command("start", async (ctx) => {
      await ctx.reply(
        `SB-OS Agent System\n\n` +
        `Send me a message and I'll route it to the right agent.\n\n` +
        `Commands:\n` +
        `• Just type — routes to Chief of Staff\n` +
        `• @cmo <message> — talk to the CMO\n` +
        `• @cto <message> — talk to the CTO\n` +
        `• @<agent-slug> <message> — talk to any agent\n` +
        `• /agents — list available agents\n` +
        `• /briefing — get today's briefing`
      );
    });

    // ---- /agents Command ----
    this.bot.command("agents", async (ctx) => {
      try {
        const { loadAllAgents } = await import("../../agents/agent-registry");
        const allAgents = await loadAllAgents();
        const active = allAgents.filter((a) => a.isActive);

        const list = active
          .map((a) => `• @${a.slug} — ${a.name} (${a.role})`)
          .join("\n");

        await ctx.reply(`Available Agents:\n\n${list}\n\nUse @slug to route your message.`);
      } catch (error: any) {
        await ctx.reply("Failed to load agent list.");
        this.recordError(error.message);
      }
    });

    // ---- /briefing Command ----
    this.bot.command("briefing", async (ctx) => {
      try {
        await ctx.reply("Generating briefing...");
        const response = await this.routeToAgent(ctx, "chief-of-staff", "Generate my daily briefing for today.");
        await this.sendLongMessage(ctx.chat.id.toString(), response);
      } catch (error: any) {
        await ctx.reply("Failed to generate briefing.");
        this.recordError(error.message);
      }
    });

    // ---- Text Messages ----
    this.bot.on("text", async (ctx) => {
      try {
        this.stats.messagesReceived++;
        this.stats.lastActivity = new Date();

        const message = this.normalizeTextMessage(ctx);
        const response = await processIncomingMessage(message);

        // Save to message store for history
        await this.saveMessageHistory(ctx.chat.id.toString(), ctx.message.text, response);

        // Send response (handle long messages)
        await this.sendLongMessage(ctx.chat.id.toString(), response);

        this.stats.messagesSent++;
      } catch (error: any) {
        logger.error({ error: error.message }, "Error processing Telegram text message");
        await ctx.reply("Sorry, I encountered an error. Please try again.");
        this.recordError(error.message);
      }
    });

    // ---- Photo Messages ----
    this.bot.on("photo", async (ctx) => {
      try {
        this.stats.messagesReceived++;
        this.stats.lastActivity = new Date();

        const caption = ctx.message.caption || "Photo received (no caption)";
        const photos = ctx.message.photo;
        const photo = photos[photos.length - 1];

        let mediaUrl: string | undefined;
        try {
          const fileLink = await ctx.telegram.getFileLink(photo.file_id);
          mediaUrl = fileLink.href;
        } catch {
          // File link may fail for large photos
        }

        const message: IncomingMessage = {
          channelMessageId: ctx.message.message_id.toString(),
          platform: "telegram",
          senderId: ctx.from.id.toString(),
          senderName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
          chatId: ctx.chat.id.toString(),
          text: `[Photo] ${caption}`,
          messageType: "photo",
          timestamp: new Date(ctx.message.date * 1000),
          mediaUrl,
        };

        const response = await processIncomingMessage(message);
        await this.sendLongMessage(ctx.chat.id.toString(), response);

        this.stats.messagesSent++;
      } catch (error: any) {
        logger.error({ error: error.message }, "Error processing Telegram photo");
        await ctx.reply("Sorry, I couldn't process your photo.");
        this.recordError(error.message);
      }
    });

    // ---- Error Handler ----
    this.bot.catch((err: any) => {
      logger.error({ error: err.message || err }, "Telegraf error");
      this.recordError(err.message || "Unknown Telegraf error");
    });

    // ---- Launch ----
    // Use polling in development, webhook in production
    if (process.env.TELEGRAM_WEBHOOK_URL) {
      const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
      await this.bot.telegram.setWebhook(webhookUrl, {
        secret_token: secret,
      });
      logger.info({ webhookUrl }, "Telegram bot started with webhook");
    } else {
      // Use polling — launch in background
      this.bot.launch().catch((err: any) => {
        logger.error({ error: err.message }, "Telegram bot polling failed");
        this.recordError(err.message);
      });
      logger.info("Telegram bot started with polling");
    }

    this.connected = true;
    this.startedAt = new Date();
  }

  async stop(): Promise<void> {
    if (this.bot) {
      this.bot.stop("SIGTERM");
      this.connected = false;
      logger.info("Telegram bot stopped");
    }
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    if (!this.bot) {
      logger.warn("Cannot send message: Telegram bot not initialized");
      return;
    }

    try {
      await this.sendLongMessage(msg.chatId, msg.text, msg.parseMode);
      this.stats.messagesSent++;
      this.stats.lastActivity = new Date();
    } catch (error: any) {
      logger.error({ chatId: msg.chatId, error: error.message }, "Failed to send Telegram message");
      this.recordError(error.message);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getStatus(): ChannelStatus {
    return {
      platform: "telegram",
      connected: this.connected,
      startedAt: this.startedAt?.toISOString() || null,
      messagesReceived: this.stats.messagesReceived,
      messagesSent: this.stats.messagesSent,
      errors: this.stats.errors,
      lastError: this.stats.lastError,
      lastActivity: this.stats.lastActivity?.toISOString() || null,
    };
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private normalizeTextMessage(ctx: any): IncomingMessage {
    return {
      channelMessageId: ctx.message.message_id.toString(),
      platform: "telegram",
      senderId: ctx.from.id.toString(),
      senderName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
      chatId: ctx.chat.id.toString(),
      text: ctx.message.text,
      messageType: "text",
      timestamp: new Date(ctx.message.date * 1000),
    };
  }

  private async routeToAgent(ctx: any, agentSlug: string, text: string): Promise<string> {
    const message: IncomingMessage = {
      channelMessageId: ctx.message?.message_id?.toString() || "0",
      platform: "telegram",
      senderId: ctx.from.id.toString(),
      senderName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
      chatId: ctx.chat.id.toString(),
      text: `@${agentSlug} ${text}`,
      messageType: "command",
      timestamp: new Date(),
    };

    return processIncomingMessage(message);
  }

  /**
   * Send a long message, splitting at 4096 char Telegram limit.
   */
  private async sendLongMessage(
    chatId: string,
    text: string,
    parseMode?: "html" | "markdown"
  ): Promise<void> {
    if (!this.bot) return;

    const maxLen = 4000; // Leave buffer below 4096 limit
    if (text.length <= maxLen) {
      await this.bot.telegram.sendMessage(chatId, text, {
        parse_mode: parseMode === "markdown" ? "MarkdownV2" : undefined,
      });
      return;
    }

    // Split into chunks at newline boundaries
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }

      let splitAt = remaining.lastIndexOf("\n", maxLen);
      if (splitAt === -1 || splitAt < maxLen / 2) {
        splitAt = maxLen;
      }

      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }

    for (const chunk of chunks) {
      await this.bot.telegram.sendMessage(chatId, chunk);
    }
  }

  private async saveMessageHistory(
    chatId: string,
    userText: string,
    aiResponse: string
  ): Promise<void> {
    try {
      await storage.createMessage({
        phoneNumber: chatId,
        messageContent: userText,
        sender: "user",
        messageType: "text",
        platform: "telegram",
        processed: true,
      });

      await storage.createMessage({
        phoneNumber: chatId,
        messageContent: aiResponse,
        sender: "assistant",
        messageType: "text",
        platform: "telegram",
        processed: true,
        aiResponse: aiResponse,
      });
    } catch (error: any) {
      // Non-critical — don't fail the response
      logger.warn({ error: error.message }, "Failed to save Telegram message history");
    }
  }

  private recordError(message: string): void {
    this.stats.errors++;
    this.stats.lastError = message;
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const telegramAdapter = new TelegramAdapter();

/**
 * Get the authorized chat IDs for sending proactive messages.
 */
export function getAuthorizedChatIds(): string[] {
  return [...AUTHORIZED_CHAT_IDS];
}
