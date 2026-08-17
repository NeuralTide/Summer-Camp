import { useEffect, useRef } from "react";
import type { AppEvent } from "./types";

/**
 * Subscribe to the daemon's SSE feed.
 *
 * This is what makes a course build feel live: lessons appear on the path as the
 * agent writes them, rather than after a refresh. The handler is held in a ref so
 * that a re-render with a new closure doesn't tear down and rebuild the stream —
 * reconnecting mid-build would drop log lines.
 */
export function useEvents(onEvent: (event: AppEvent) => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let source: EventSource | undefined;
    let retry: number | undefined;
    let closed = false;
    let backoff = 1000;

    const connect = () => {
      if (closed) return;
      source = new EventSource("/api/events");

      source.onmessage = (message) => {
        backoff = 1000;
        try {
          handler.current(JSON.parse(message.data) as AppEvent);
        } catch {
          // A single malformed frame must not kill the stream.
        }
      };

      source.onerror = () => {
        source?.close();
        if (closed) return;
        // The daemon may be restarting; back off rather than hammering it.
        retry = window.setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 15000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      source?.close();
    };
  }, []);
}
