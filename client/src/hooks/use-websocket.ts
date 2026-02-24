/**
 * useWebSocket — Real-time event bus hook
 *
 * Connects to the server WebSocket and provides:
 * - Auto-reconnect with exponential backoff
 * - Event subscription by channel
 * - Auto-invalidation of TanStack Query caches
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface WSEvent {
  channel: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

// Channel → TanStack Query keys to invalidate
const CHANNEL_QUERY_MAP: Record<string, string[][]> = {
  "tasks:updated": [["tasks"], ["dashboard-top3"], ["dashboard-urgent"]],
  "health:updated": [["health"], ["dashboard-readiness"]],
  "nutrition:updated": [["nutrition"]],
  "telegram:message": [["telegram-messages"]],
  "agent:activity": [["agents"]],
};

export function useWebSocket() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WSEvent | null>(null);
  const reconnectAttempts = useRef(0);

  const connect = useCallback(() => {
    // Build WebSocket URL from current location
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectAttempts.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const parsed: WSEvent = JSON.parse(event.data);

          if (parsed.channel) {
            setLastEvent(parsed);

            // Auto-invalidate relevant queries
            const queryKeys = CHANNEL_QUERY_MAP[parsed.channel];
            if (queryKeys) {
              for (const key of queryKeys) {
                queryClient.invalidateQueries({ queryKey: key });
              }
            }
          }
        } catch {
          // Ignore non-JSON messages (pong, connected, etc.)
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;

        // Reconnect with exponential backoff (max 30s)
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;

        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // Will trigger onclose
      };
    } catch {
      // WebSocket not available
    }
  }, [queryClient]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const subscribe = useCallback((channel: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "subscribe", channel }));
    }
  }, []);

  return { connected, lastEvent, subscribe };
}
