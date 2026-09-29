import { useEffect, useState } from "react";
import type { Snapshot } from "../../server/model.ts";
import { handleAlertEvent } from "./alerts-runtime.ts";

export type Connection = "connecting" | "live" | "lost";

export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  // 서버가 지금 내주는 화면 번들(undefined: 아직 모름, null: 서버에 빌드 없음). 재연결하면 서버가 다시 보낸다.
  const [serverBuild, setServerBuild] = useState<string | null>();

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("version", (e) => {
      setServerBuild((JSON.parse((e as MessageEvent).data) as { build: string | null }).build);
    });
    es.addEventListener("snapshot", (e) => {
      setSnapshot(JSON.parse((e as MessageEvent).data));
      setConnection("live");
    });
    // SUPERVISOR alerts(ATC-87): key가 처음 생기거나 사라질 때
    es.addEventListener("alert", (e) => void handleAlertEvent(JSON.parse((e as MessageEvent).data)));
    es.onopen = () => setConnection("live");
    es.onerror = () => setConnection("lost");
    return () => es.close();
  }, []);

  return { snapshot, connection, serverBuild };
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
