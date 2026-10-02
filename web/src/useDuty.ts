import { useEffect, useState } from "react";
import { chatFromHistory, type Chat, emptyChat, foldDuty, type DutyWire } from "../../server/duty-chat.ts";
import { apiGet } from "./api.ts";

// DUTY 대화(ATC-220). SSE `duty` topic을 따로 연다(기본 스트림에는 없다). 연결(재연결 포함)마다 서버가 status를 먼저 보내고,
// 그때 기록(GET /api/duty/history)으로 목록을 새로 만든 뒤 이벤트를 접는다. 꺼져 있으면 status.enabled가 false로 오고 기록도 읽지 않는다.
export function useDuty(): Chat {
  const [chat, setChat] = useState<Chat>(emptyChat);
  useEffect(() => {
    const es = new EventSource("/api/events?topics=duty");
    let alive = true;
    es.addEventListener("duty", (m) => {
      let e: DutyWire;
      try {
        e = JSON.parse((m as MessageEvent).data) as DutyWire;
      } catch {
        return;
      }
      if (e.type === "status") {
        // 이 뒤의 이벤트를 놓치지 않도록 상태를 먼저 접고, 기록은 도착하는 대로 바꿔 끼운다(기록이 늦으면 그 사이 이벤트는 기록에 이미 들어 있다)
        setChat((c) => foldDuty(c, e));
        if (e.enabled) {
          void apiGet("/api/duty/history")
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((h: { lines: Parameters<typeof chatFromHistory>[0] }) => alive && setChat((c) => ({ ...chatFromHistory(h.lines, c.status) })))
            .catch(() => {});
        } else {
          setChat((c) => ({ ...emptyChat(), status: c.status }));
        }
        return;
      }
      setChat((c) => foldDuty(c, e));
    });
    return () => {
      alive = false;
      es.close();
    };
  }, []);
  return chat;
}
