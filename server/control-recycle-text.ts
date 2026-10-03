// CONTROL RECYCLE 알림·기록의 순수 부분(ATC-166). 화면 번들도 supervisor-alerts.ts를 통해 이 파일을 가져오므로 node·config를 import하지 않는다.

// CAP을 넘었지만 자동 재시작 대상이 아닌 세션(OCC)의 알림 입력. 모드와 상관없이 재고 알린다
export interface OverCap {
  session: string;
  context: number;
  cap: number;
}
export function overCapAlertTextOf(o: OverCap): { text: string; next: string } {
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  return { text: `CONTROL RECYCLE — ${o.session} 컨텍스트 ${k(o.context)} > CAP ${k(o.cap)}, 자동 재시작 대상이 아님`, next: "안전한 순간에 FLEET 탭 CONTROL SESSIONS에서 STOP·LAUNCH한다" };
}

// CAP을 넘고 wait인 채 waitAlertMin이 지난 세션(ATC-175). 알림 입력
export interface WaitStuck {
  session: string;
  context: number;
  cap: number;
  blocks: string[];
  since: string; // 처음 wait가 된 것을 본 때
  minutes: number;
}
export function waitAlertTextOf(w: WaitStuck): { text: string; next: string } {
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  return {
    text: `CONTROL RECYCLE — ${w.session} 컨텍스트 ${k(w.context)} > CAP ${k(w.cap)}인데 ${w.minutes}분째 재시작하지 못함: ${w.blocks.join("; ")}`,
    next: `막는 것이 풀리기를 기다리거나, 괜찮다고 판단하면 FLEET 탭 CONTROL SESSIONS에서 ${w.session}을 손으로 STOP하고 LAUNCH한다`,
  };
}

export type RecycleResult = "recycled" | "would" | "would-wait" | "stop-failed" | "stop-unverified" | "stop-unconfirmed" | "launch-failed";
export interface RecycleRecord {
  t: string;
  session: string;
  contextBefore: number;
  reason: string;
  result: RecycleResult;
  mode: "shadow" | "on";
  ok: boolean;
  account?: string;
  jobId?: string; // 새 job
  error?: string;
  // stop-unconfirmed(ATC-175): STOP을 확인하지 못했어도 LAUNCH를 시도한 결과. launchControl은 살아 있는 줄이 있으면 스스로 거절한다
  launch?: { ok: boolean; jobId?: string; error?: string };
  blocks?: string[]; // would-wait: 막고 있는 것
}

// 알림 한 줄(supervisor-alerts.ts가 쓴다): 성공이면 ADVISORY, 실패면 CAUTION. 실패가 세션을 멈춘 채 두는 경우(launch-failed)는 그렇게 말한다
export function recycleAlertTextOf(r: Pick<RecycleRecord, "session" | "contextBefore" | "result" | "error" | "launch">): { text: string; next: string } {
  const k = `${Math.round(r.contextBefore / 1000)}k`;
  if (r.result === "recycled") return { text: `CONTROL RECYCLE — ${r.session} 재시작함(컨텍스트 ${k})`, next: "" };
  const why = r.error ? ` — ${r.error}` : "";
  if (r.result === "launch-failed") return { text: `CONTROL RECYCLE — ${r.session}을 멈췄지만 LAUNCH가 실패해 멈춘 채로 있음(컨텍스트 ${k})${why}`, next: "FLEET 탭 CONTROL SESSIONS에서 LAUNCH한다" };
  // ATC-521: claude stop은 종료 코드 0이었지만 job state.json이 stopped가 되지 않았다. 옛 세션이 계속 돌 수 있어 새로 띄우지 않았다
  if (r.result === "stop-unverified") return { text: `CONTROL RECYCLE — ${r.session}: claude stop은 성공했지만 job이 멈췄는지 확인하지 못해 새 세션을 띄우지 않음(컨텍스트 ${k})${why}`, next: "FLEET 탭 CONTROL SESSIONS에서 그 job의 상태를 보고 계속 돌면 직접 멈춘다" };
  if (r.result === "stop-unconfirmed") {
    // 확인하지 못했어도 LAUNCH를 시도했다(ATC-175). 세션이 도는지 분명히 말한다
    if (r.launch?.ok) return { text: `CONTROL RECYCLE — ${r.session} STOP을 확인하지 못했지만 LAUNCH가 성공해 새 세션이 돌고 있음(컨텍스트 ${k})`, next: "FLEET 탭 CONTROL SESSIONS에서 세션이 하나뿐인지 본다" };
    if (r.launch) return { text: `CONTROL RECYCLE — ${r.session} STOP을 확인하지 못했고 LAUNCH도 거절됨(옛 줄이 아직 살아 있음). 세션이 내려갔을 수 있음(컨텍스트 ${k}) — ${r.launch.error ?? "LAUNCH 거절"}`, next: "FLEET 탭 CONTROL SESSIONS에서 상태를 보고 필요하면 STOP·LAUNCH한다" };
    return { text: `CONTROL RECYCLE — ${r.session} STOP을 확인하지 못함(컨텍스트 ${k})${why}`, next: "FLEET 탭 CONTROL SESSIONS에서 상태를 보고 STOP·LAUNCH한다" };
  }
  return { text: `CONTROL RECYCLE — ${r.session} STOP이 실패함, 세션은 그대로 돎(컨텍스트 ${k})${why}`, next: "FLEET 탭 CONTROL SESSIONS에서 상태를 본다" };
}
