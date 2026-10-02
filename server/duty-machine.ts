// DUTY 프로세스의 상태 기계(ATC-220, docs/duty.md 3). 순수: (상태, 사건, 시각) → (새 상태, 할 일).
// 프로세스는 하나, 입력 큐는 하나. 턴은 `result`에서 끝난다. 유휴 시간이 지나면 stdin을 닫아 끝내고, 다음 글이 --resume으로 다시 띄운다.
// 예상 밖 종료는 `down`. 5분 안에 3번 그러면 NEW SHIFT나 설정 변경까지 `down`에 머문다(다시 띄우기를 되풀이하지 않는다).
export const CRASH_LIMIT = 3;
export const CRASH_WINDOW_MS = 5 * 60_000;

export interface DutyMsg {
  text: string;
  image?: { mediaType: string; file: string }; // 붙인 그림: 상태 폴더 duty-images/ 아래 파일 이름
  review?: string; // 서버가 시작한 REVIEW 턴(ATC-396)의 한 줄 표시. 있으면 대화 기록에는 SUPERVISOR 글이 아니라 이 줄(notice)이 남는다
}

export type DutyPhase = "idle" | "thinking" | "down";

export interface DutyState {
  phase: DutyPhase;
  alive: boolean; // 프로세스가 떠 있는가
  closing: boolean; // 우리가 끝내는 중(유휴·NEW SHIFT·설정 끔): 이 종료는 오류가 아니다
  queue: DutyMsg[]; // 턴이 도는 동안 들어온 글(순서대로)
  sessionId: string | null; // 이어 갈 대화 id. null이면 다음 spawn이 새로 만든다
  fresh: boolean; // 다음 spawn이 새 --session-id로 시작한다
  lastActiveAt: number; // 마지막 입력·결과 시각
  crashes: number[]; // 예상 밖 종료 시각
  blocked: boolean; // 다시 띄우기를 멈춤(crashes가 한도)
  retiring: boolean; // ACCOUNT가 바뀌었는데 턴이 도는 중(ATC-242): 이 턴은 옛 프로세스에서 끝내고, 줄 선 글은 새 대화로 띄운 프로세스가 받는다
  error: string | null; // down일 때 마지막 stderr 줄
}

export const initialState = (sessionId: string | null = null): DutyState => ({
  phase: "idle",
  alive: false,
  closing: false,
  queue: [],
  sessionId,
  fresh: sessionId === null,
  lastActiveAt: 0,
  crashes: [],
  blocked: false,
  retiring: false,
  error: null,
});

export type DutyEventIn =
  | { kind: "message"; msg: DutyMsg }
  | { kind: "result" } // 턴 끝
  | { kind: "exit"; error?: string } // 프로세스가 끝남
  | { kind: "stop" }
  | { kind: "new-shift" }
  | { kind: "idle-tick"; idleMs: number }
  | { kind: "disable" } // 설정을 껐다
  | { kind: "reconfigure" }; // 설정(ACCOUNT 등)이 바뀌었다

export type DutyAction =
  | { do: "spawn"; resume: boolean } // 이어 갈 대화가 있으면 resume
  | { do: "write"; msg: DutyMsg }
  | { do: "interrupt" }
  | { do: "close-stdin" } // 부드럽게 끝낸다(SIGKILL 아님)
  | { do: "kill" }; // NEW SHIFT·끔에서 턴이 도는 중일 때만: 어차피 버릴 대화

export type SendVerdict = "sent" | "queued" | "refused";
export interface Step {
  state: DutyState;
  actions: DutyAction[];
  verdict?: SendVerdict; // message 사건의 결과: 보냈다 / "DUTY is answering"으로 줄 세웠다 / down이라 거절
}

const recent = (crashes: readonly number[], now: number) => crashes.filter((t) => now - t < CRASH_WINDOW_MS);

export function step(s: DutyState, e: DutyEventIn, now: number): Step {
  switch (e.kind) {
    case "message": {
      if (s.blocked) return { state: s, actions: [], verdict: "refused" };
      if (s.phase === "thinking") return { state: { ...s, queue: [...s.queue, e.msg], lastActiveAt: now }, actions: [], verdict: "queued" };
      const actions: DutyAction[] = [];
      if (!s.alive) actions.push({ do: "spawn", resume: !s.fresh && s.sessionId !== null });
      actions.push({ do: "write", msg: e.msg });
      return { state: { ...s, phase: "thinking", alive: true, closing: false, fresh: false, error: null, lastActiveAt: now }, actions, verdict: "sent" };
    }
    case "result": {
      if (s.phase !== "thinking") return { state: s, actions: [] };
      if (s.retiring) return { state: { ...s, phase: "idle", closing: true, lastActiveAt: now }, actions: [{ do: "close-stdin" }] }; // 옛 ACCOUNT의 마지막 턴이 끝났다
      const [next, ...rest] = s.queue;
      if (next) return { state: { ...s, queue: rest, lastActiveAt: now }, actions: [{ do: "write", msg: next }] };
      return { state: { ...s, phase: "idle", lastActiveAt: now }, actions: [] };
    }
    case "stop":
      return { state: s, actions: s.phase === "thinking" && s.alive ? [{ do: "interrupt" }] : [] };
    case "exit": {
      if (s.retiring && s.closing) {
        // 옛 프로세스가 끝났다: 줄 선 글이 있으면 새 ACCOUNT에서 새 대화로 이어 받는다
        const [next, ...rest] = s.queue;
        if (!next) return { state: { ...s, alive: false, closing: false, retiring: false, phase: "idle", queue: [] }, actions: [] };
        return { state: { ...s, alive: true, closing: false, retiring: false, phase: "thinking", fresh: false, queue: rest, lastActiveAt: now }, actions: [{ do: "spawn", resume: false }, { do: "write", msg: next }] };
      }
      if (s.closing || !s.alive) return { state: { ...s, alive: false, closing: false, phase: s.phase === "down" ? "down" : "idle", queue: s.closing ? s.queue : [], retiring: false }, actions: [] };
      const crashes = [...recent(s.crashes, now), now];
      const blocked = crashes.length >= CRASH_LIMIT;
      return { state: { ...s, alive: false, phase: "down", queue: [], retiring: false, crashes, blocked, error: e.error ?? "process exited" }, actions: [] };
    }
    case "idle-tick": {
      if (!s.alive || s.closing || s.phase !== "idle" || now - s.lastActiveAt < e.idleMs) return { state: s, actions: [] };
      return { state: { ...s, closing: true }, actions: [{ do: "close-stdin" }] };
    }
    case "new-shift": {
      const base = { ...s, retiring: false, queue: [], sessionId: null, fresh: true, crashes: [], blocked: false, error: null, phase: "idle" as const, lastActiveAt: now };
      if (!s.alive) return { state: { ...base, closing: false }, actions: [] };
      return { state: { ...base, closing: true }, actions: [{ do: s.phase === "thinking" ? "kill" : "close-stdin" }] };
    }
    case "disable": {
      const base = { ...s, retiring: false, queue: [], phase: "idle" as const, error: null, crashes: [], blocked: false };
      if (!s.alive) return { state: { ...base, closing: false }, actions: [] };
      return { state: { ...base, closing: true }, actions: [{ do: s.phase === "thinking" ? "kill" : "close-stdin" }] };
    }
    case "reconfigure": {
      // ACCOUNT가 바뀌면 --resume이 안 되니 새 대화로 시작한다. 막힌 것도 푼다. 턴이 도는 중이면 그 턴은 옛 프로세스에서 끝낸다(ATC-242, retiring)
      if (s.alive && s.phase === "thinking" && !s.closing) return { state: { ...s, sessionId: null, fresh: true, crashes: [], blocked: false, error: null, retiring: true }, actions: [] };
      const base = { ...s, retiring: false, queue: [], sessionId: null, fresh: true, crashes: [], blocked: false, error: null, phase: "idle" as const };
      if (!s.alive) return { state: { ...base, closing: false }, actions: [] };
      return { state: { ...base, closing: true }, actions: [{ do: s.phase === "thinking" ? "kill" : "close-stdin" }] };
    }
  }
}
