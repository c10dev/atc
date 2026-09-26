import { useEffect, useState } from "react";
import type { Snapshot } from "../../server/model.ts";

export type Connection = "connecting" | "live" | "lost";

export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("snapshot", (e) => {
      setSnapshot(JSON.parse((e as MessageEvent).data));
      setConnection("live");
    });
    es.onopen = () => setConnection("live");
    es.onerror = () => setConnection("lost");
    return () => es.close();
  }, []);

  return { snapshot, connection };
}

// 상대 시간 표시가 흘러가도록 주기적으로 다시 그린다.
export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
