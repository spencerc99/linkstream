import { useEffect, useRef } from "react";

export function useJetStream({
  onMessage,
  onConnectionChange,
  wantedCollections,
}: {
  onMessage: (data: any) => void;
  onConnectionChange: (connected: boolean) => void;
  wantedCollections: string[];
}) {
  const wsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    const ws = new WebSocket(
      `wss://jetstream2.us-west.bsky.network/subscribe?wantedCollections=${wantedCollections.join(
        ","
      )}`
    );
    ws.onopen = () => onConnectionChange(true);
    ws.onclose = () => onConnectionChange(false);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onMessage(data);
    };
    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    if (wsRef.current) {
      wsRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        onMessage(data);
      };
    }
  }, [wsRef, onMessage]);
}
