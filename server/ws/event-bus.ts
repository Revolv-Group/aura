/**
 * WebSocket Event Bus — Real-Time Dashboard Updates
 *
 * Provides a pub/sub system for pushing live updates to connected clients.
 * Clients subscribe to channels, server pushes events when data changes.
 *
 * Channels:
 * - tasks:updated — Task created, updated, or completed
 * - health:updated — Health entry changed
 * - nutrition:updated — Nutrition entry changed
 * - telegram:message — New Telegram message received
 * - nudge:sent — Proactive nudge sent
 * - agent:activity — Agent started/completed a task
 * - system:status — System health changes
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import { logger } from "../logger";

// ============================================================================
// TYPES
// ============================================================================

export interface WSEvent {
  channel: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

interface WSClient {
  ws: WebSocket;
  subscriptions: Set<string>;
  connectedAt: number;
}

// ============================================================================
// EVENT BUS SINGLETON
// ============================================================================

let wss: WebSocketServer | null = null;
const clients = new Map<string, WSClient>();
let clientIdCounter = 0;

/**
 * Initialize WebSocket server on the existing HTTP server
 */
export function initWebSocket(server: HttpServer): WebSocketServer {
  if (wss) return wss;

  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    const clientId = `ws-${++clientIdCounter}`;
    const client: WSClient = {
      ws,
      subscriptions: new Set(["*"]), // Subscribe to all by default
      connectedAt: Date.now(),
    };
    clients.set(clientId, client);

    logger.debug({ clientId }, "WebSocket client connected");

    ws.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "subscribe" && msg.channel) {
          client.subscriptions.add(msg.channel);
          ws.send(JSON.stringify({ type: "subscribed", channel: msg.channel }));
        }

        if (msg.type === "unsubscribe" && msg.channel) {
          client.subscriptions.delete(msg.channel);
          ws.send(JSON.stringify({ type: "unsubscribed", channel: msg.channel }));
        }

        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      clients.delete(clientId);
      logger.debug({ clientId }, "WebSocket client disconnected");
    });

    ws.on("error", (err) => {
      logger.debug({ clientId, error: err.message }, "WebSocket error");
      clients.delete(clientId);
    });

    // Send welcome
    ws.send(
      JSON.stringify({
        type: "connected",
        clientId,
        timestamp: Date.now(),
      })
    );
  });

  logger.info("WebSocket server initialized on /ws");
  return wss;
}

/**
 * Broadcast an event to all subscribed clients
 */
export function broadcast(channel: string, type: string, data: Record<string, unknown> = {}): void {
  if (!wss || clients.size === 0) return;

  const event: WSEvent = {
    channel,
    type,
    data,
    timestamp: Date.now(),
  };

  const message = JSON.stringify(event);

  clients.forEach((client) => {
    if (client.ws.readyState !== WebSocket.OPEN) return;

    // Check if client is subscribed to this channel (or wildcard)
    if (client.subscriptions.has("*") || client.subscriptions.has(channel)) {
      try {
        client.ws.send(message);
      } catch {
        // Client gone, will be cleaned up on close
      }
    }
  });
}

/**
 * Get current WebSocket stats
 */
export function getWSStats(): { connected: number; channels: string[] } {
  const allChannels = new Set<string>();
  clients.forEach((client) => {
    client.subscriptions.forEach((ch) => {
      allChannels.add(ch);
    });
  });

  return {
    connected: clients.size,
    channels: Array.from(allChannels),
  };
}

// ============================================================================
// CONVENIENCE BROADCAST METHODS
// ============================================================================

export function broadcastTaskUpdate(taskId: string, action: "created" | "updated" | "completed" | "deleted"): void {
  broadcast("tasks:updated", action, { taskId });
}

export function broadcastHealthUpdate(entryId: string): void {
  broadcast("health:updated", "changed", { entryId });
}

export function broadcastNutritionUpdate(entryId: string): void {
  broadcast("nutrition:updated", "changed", { entryId });
}

export function broadcastTelegramMessage(chatId: string, direction: string): void {
  broadcast("telegram:message", direction, { chatId });
}

export function broadcastNudge(type: string, message: string): void {
  broadcast("nudge:sent", type, { message });
}

export function broadcastAgentActivity(agentSlug: string, status: "started" | "completed" | "error"): void {
  broadcast("agent:activity", status, { agentSlug });
}
