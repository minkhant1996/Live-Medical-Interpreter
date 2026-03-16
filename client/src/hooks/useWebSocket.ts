import { useRef, useCallback, useEffect, useState } from "react";
import type { WSServerMessage } from "../types";

const RECONNECT_INTERVAL = 5000; // Retry every 5 seconds

interface RoomAuth {
  token: string;
  roomCode: string;
}

export function useWebSocket(
  onMessage: (msg: WSServerMessage) => void,
  roomAuth?: RoomAuth
) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const roomAuthRef = useRef(roomAuth);
  roomAuthRef.current = roomAuth;
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  const wasReplacedRef = useRef(false);
  const connectingRef = useRef(false);
  const connectionIdRef = useRef(0);

  const connect = useCallback(() => {
    // If already open, nothing to do
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log("Already connected, skipping");
      return;
    }

    // If currently connecting, wait for it
    if (connectingRef.current) {
      console.log("Already connecting, skipping");
      return;
    }

    // Close any existing socket that's not open
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    connectingRef.current = true;
    connectionIdRef.current++;
    const thisConnectionId = connectionIdRef.current;
    wasReplacedRef.current = false;
    intentionalCloseRef.current = false;

    // Determine WebSocket URL:
    // 1. Use VITE_WS_HOST env var if set (for ngrok/external testing)
    // 2. Otherwise use current host (Vite proxy handles /ws in dev)
    const envWsHost = import.meta.env.VITE_WS_HOST;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

    let wsUrl: string;
    if (envWsHost) {
      // External testing (ngrok) - connect directly
      wsUrl = `${protocol}//${envWsHost}/ws/interpret`;
    } else {
      // Use current host - Vite proxy will forward /ws to backend
      wsUrl = `${protocol}//${window.location.host}/ws/interpret`;
    }

    console.log("WebSocket connecting to:", wsUrl);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      // Ignore if this is a stale connection (component unmounted and remounted)
      if (thisConnectionId !== connectionIdRef.current) {
        console.log("Stale connection opened, closing");
        ws.close();
        return;
      }

      console.log("WebSocket connected");
      connectingRef.current = false;
      setConnected(true);
      setReconnecting(false);
      reconnectAttemptRef.current = 0;

      // Auto-send join_room if roomAuth is provided
      if (roomAuthRef.current) {
        ws.send(
          JSON.stringify({
            type: "join_room",
            token: roomAuthRef.current.token,
            code: roomAuthRef.current.roomCode,
          })
        );
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg: WSServerMessage = JSON.parse(event.data);
        // Debug: log audio_message specifically
        if (msg.type === "audio_message") {
          console.log("[WS Raw] Received audio_message:", { id: (msg as any).id, role: (msg as any).role, timestamp: (msg as any).timestamp, hasAudio: !!(msg as any).audioBase64 });
        }
        onMessageRef.current(msg);
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    };

    ws.onclose = (event) => {
      // Ignore if this is a stale connection
      if (thisConnectionId !== connectionIdRef.current) {
        console.log("Stale connection closed, ignoring");
        return;
      }

      console.log(`WebSocket disconnected: code=${event.code} reason=${event.reason}`);
      connectingRef.current = false;
      setConnected(false);
      wsRef.current = null;

      // Don't reconnect if:
      // 1. Intentionally closed by client
      // 2. Replaced by new connection (another tab/device)
      const wasReplaced = event.reason?.includes("Replaced") || event.reason?.includes("another device");

      if (wasReplaced) {
        console.log("Connection was replaced, not reconnecting");
        wasReplacedRef.current = true;
        setReconnecting(false);
      } else if (!intentionalCloseRef.current && !wasReplacedRef.current) {
        // Auto-reconnect every 5 seconds
        attemptReconnect();
      }
    };

    ws.onerror = (err) => {
      // Ignore if stale connection
      if (thisConnectionId !== connectionIdRef.current) return;
      console.error("WebSocket error:", err);
      // onclose will fire after onerror, reconnect handled there
    };

    wsRef.current = ws;
  }, []);

  const attemptReconnect = useCallback(() => {
    // Clear any existing timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    setReconnecting(true);
    reconnectAttemptRef.current++;

    const attempt = reconnectAttemptRef.current;

    // First attempt is immediate, then every 5 seconds
    if (attempt === 1) {
      console.log(`Reconnecting immediately (attempt ${attempt})`);
      // Small delay to avoid tight loop
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, 100);
    } else {
      console.log(`Reconnecting in 5s (attempt ${attempt})`);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, RECONNECT_INTERVAL);
    }
  }, [connect]);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      console.warn("WebSocket not connected, message dropped");
    }
  }, []);

  const disconnect = useCallback(() => {
    // Increment connection ID to invalidate any in-flight connections
    connectionIdRef.current++;
    intentionalCloseRef.current = true;
    connectingRef.current = false;
    wasReplacedRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    setConnected(false);
    setReconnecting(false);
  }, []);

  // Reset reconnect counter and flags (call when user wants to retry)
  const resetReconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    wasReplacedRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      // Cleanup: invalidate connections and close
      connectionIdRef.current++;
      intentionalCloseRef.current = true;
      connectingRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
    };
  }, []);

  return { connected, reconnecting, connect, send, disconnect, resetReconnect };
}
