/**
 * Agent Message Bus
 *
 * Inter-agent communication bus for the SB-OS hierarchical multi-agent system.
 * EventEmitter-based message passing with per-agent buffering and convenience methods.
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { logger } from "../logger";
import type { AgentMessage, AgentMessageType } from "./types";

const MAX_BUFFER_SIZE = 100;

export class AgentMessageBus extends EventEmitter {
  /** Per-agent ring buffer: agentId → last N messages */
  private messageBuffer: Map<string, AgentMessage[]> = new Map();

  // ---------------------------------------------------------------------------
  // Core send
  // ---------------------------------------------------------------------------

  /**
   * Assign id and timestamp, emit the message type event, buffer for recipient.
   */
  send(message: Omit<AgentMessage, "id" | "timestamp">): AgentMessage {
    const fullMessage: AgentMessage = {
      ...message,
      id: randomUUID(),
      timestamp: new Date(),
    };

    logger.info(
      {
        messageId: fullMessage.id,
        type: fullMessage.type,
        fromAgentId: fullMessage.fromAgentId,
        toAgentId: fullMessage.toAgentId,
        taskId: fullMessage.taskId,
        contentPreview: fullMessage.content.slice(0, 100),
      },
      `[MessageBus] ${fullMessage.type}: ${fullMessage.fromAgentId} → ${fullMessage.toAgentId}`
    );

    this._bufferMessage(fullMessage);
    this.emit(fullMessage.type, fullMessage);

    return fullMessage;
  }

  // ---------------------------------------------------------------------------
  // Convenience senders
  // ---------------------------------------------------------------------------

  /**
   * Delegation: parent agent delegates a task to a child agent.
   */
  sendDelegation(
    fromAgentId: string,
    toAgentId: string,
    taskId: string,
    description: string
  ): AgentMessage {
    return this.send({
      type: "agent:delegation",
      fromAgentId,
      toAgentId,
      taskId,
      content: description,
    });
  }

  /**
   * Result: child agent returns a completed result to the delegating agent.
   */
  sendResult(
    fromAgentId: string,
    toAgentId: string,
    taskId: string,
    result: string
  ): AgentMessage {
    return this.send({
      type: "agent:result",
      fromAgentId,
      toAgentId,
      taskId,
      content: result,
    });
  }

  /**
   * Broadcast: send a message to all agents subscribed to "agent:broadcast".
   * toAgentId is set to "broadcast" to indicate fanout.
   */
  broadcast(
    fromAgentId: string,
    content: string,
    metadata?: Record<string, unknown>
  ): AgentMessage {
    return this.send({
      type: "agent:broadcast",
      fromAgentId,
      toAgentId: "broadcast",
      content,
      metadata,
    });
  }

  /**
   * Escalate: specialist raises an issue to a manager/executive.
   */
  escalate(
    fromAgentId: string,
    toAgentId: string,
    content: string
  ): AgentMessage {
    return this.send({
      type: "agent:escalation",
      fromAgentId,
      toAgentId,
      content,
    });
  }

  // ---------------------------------------------------------------------------
  // Subscription helpers
  // ---------------------------------------------------------------------------

  /**
   * Register a handler that fires whenever a message is sent to `agentId`.
   * Listens on all message type events and filters by toAgentId.
   */
  onMessage(agentId: string, handler: (message: AgentMessage) => void): void {
    const allTypes: AgentMessageType[] = [
      "agent:message",
      "agent:delegation",
      "agent:result",
      "agent:broadcast",
      "agent:escalation",
      "agent:schedule",
    ];

    const wrappedHandler = (message: AgentMessage) => {
      if (message.toAgentId === agentId || message.toAgentId === "broadcast") {
        handler(message);
      }
    };

    // Store the wrapped handler keyed by agentId + original handler reference
    // so it can be removed later.
    const key = this._handlerKey(agentId, handler);
    this._wrappedHandlers.set(key, wrappedHandler);

    for (const type of allTypes) {
      this.on(type, wrappedHandler);
    }
  }

  /**
   * Remove a previously registered handler for `agentId`.
   */
  offMessage(agentId: string, handler: (message: AgentMessage) => void): void {
    const key = this._handlerKey(agentId, handler);
    const wrappedHandler = this._wrappedHandlers.get(key);

    if (!wrappedHandler) return;

    const allTypes: AgentMessageType[] = [
      "agent:message",
      "agent:delegation",
      "agent:result",
      "agent:broadcast",
      "agent:escalation",
      "agent:schedule",
    ];

    for (const type of allTypes) {
      this.off(type, wrappedHandler);
    }

    this._wrappedHandlers.delete(key);
  }

  // ---------------------------------------------------------------------------
  // Buffer access
  // ---------------------------------------------------------------------------

  /**
   * Retrieve recent messages for an agent (most recent last), capped by `limit`.
   */
  getRecentMessages(agentId: string, limit: number = MAX_BUFFER_SIZE): AgentMessage[] {
    const buffer = this.messageBuffer.get(agentId) ?? [];
    return buffer.slice(-limit);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Map from stable key → wrapped listener, so we can remove it later. */
  private _wrappedHandlers: Map<string, (message: AgentMessage) => void> = new Map();

  private _handlerKey(
    agentId: string,
    handler: (message: AgentMessage) => void
  ): string {
    // Use the function reference identity as part of the key.
    return `${agentId}::${handler.toString().slice(0, 64)}`;
  }

  private _bufferMessage(message: AgentMessage): void {
    const targetId = message.toAgentId === "broadcast" ? "broadcast" : message.toAgentId;

    this._appendToBuffer(targetId, message);

    // Also buffer under fromAgentId so senders can retrieve sent history.
    if (message.fromAgentId !== targetId) {
      this._appendToBuffer(message.fromAgentId, message);
    }
  }

  private _appendToBuffer(agentId: string, message: AgentMessage): void {
    if (!this.messageBuffer.has(agentId)) {
      this.messageBuffer.set(agentId, []);
    }

    const buffer = this.messageBuffer.get(agentId)!;
    buffer.push(message);

    // Trim to the last MAX_BUFFER_SIZE entries.
    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
    }
  }
}

// ----------------------------------------------------------------------------
// Singleton
// ----------------------------------------------------------------------------

export const messageBus = new AgentMessageBus();
