import { useEffect, useState } from "react";
import type { Milestones } from "../../server/milestones.ts";
import type { FlightProgress } from "../../server/progress.ts";

// OOOI(ATC-123)와 진행 막대(ATC-211): FLIGHT마다 OUT·OFF·ON·IN과 지금 구간. 서버에 없거나 실패하면 비어 있고 아무것도 그리지 않는다.
// 스냅샷이 바뀌는 분(refreshKey)마다 다시 읽는다. 스냅샷마다 읽지 않는다
export interface MilestoneData {
  flights: ReadonlyMap<string, Milestones>;
  progress: ReadonlyMap<string, FlightProgress>;
}
const EMPTY: MilestoneData = { flights: new Map(), progress: new Map() };

export function useMilestones(refreshKey: string): MilestoneData {
  const [data, setData] = useState<MilestoneData>(EMPTY);
  useEffect(() => {
    let live = true;
    fetch("/api/milestones")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { flights?: Record<string, Milestones>; progress?: Record<string, FlightProgress> } | null) => live && setData({ flights: new Map(Object.entries(b?.flights ?? {})), progress: new Map(Object.entries(b?.progress ?? {})) }))
      .catch(() => live && setData(EMPTY));
    return () => {
      live = false;
    };
  }, [refreshKey]);
  return data;
}
