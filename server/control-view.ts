import type { Job } from "./job-state.ts";

// FLEET 탭 CONTROL SESSIONS 구역의 계산(ATC-130). 줄마다 live 배지와 버튼, 새로 읽는 간격. 화면(web/src/views/fleet/ControlSessions.tsx)은 이 결과를 그리기만 한다.
// API(/api/control/sessions)와 그 모양은 그대로다(docs/fleet.md 8.5.1).
export type ControlLive = { id?: string; name?: string; kind: string; status?: string; tmux?: string; job?: Job | null };
export type ControlSession = { name: string; dir: string | null; prompt: string | null; launch: "bg" | null; blocked: string | null; live: ControlLive[]; stale?: { id?: string; name?: string }[] };
export type ControlList = { daemonInService?: boolean; sessions: ControlSession[] };

// /api/control/sessions를 이보다 자주 읽지 않는다. `claude agents`를 매번 부르는 값이라 서버가 아끼는 만큼 화면도 아낀다(ATC-127의 30초 캐시와 별개로 늘 60초)
export const CONTROL_POLL_MS = 60_000;

// 마지막으로 읽은 뒤 60초가 지났나. 처음이면(lastAt null) 읽는다. 동작(LAUNCH·STOP) 뒤는 force로 곧장 읽는다
export const controlPollDue = (lastAt: number | null, now: number, force = false): boolean => force || lastAt === null || now - lastAt >= CONTROL_POLL_MS;

export type ControlBadgeTone = "busy" | "other" | "dead";
export type ControlAction = { kind: "stop"; tmux: string | null } | { kind: "launch"; disabled: boolean; title: string | null } | null;
export interface ControlRow {
  name: string;
  dir: string;
  badge: string; // BG <id> | tmux <세션> | interactive | not running
  tone: ControlBadgeTone;
  detail: string | null;
  how: string | null; // 띄운 방식. 첫 메시지를 보여 줄 때만
  action: ControlAction; // STOP·LAUNCH·없음(ENGINEERING은 배지만)
  needs: Job | null; // job이 blocked면 NEEDS YOU
  working: Job | null; // job이 working이고 detail이 있으면 그 한 줄
  launchOff: string | null; // LAUNCH를 끈 사유(launch가 있는 줄만)
  stale: string[]; // STALE job id(ATC-93). live가 아니고 LAUNCH를 막지 않는다
}

// 한 줄의 표시. 살아 있는 background 세션이 있으면 그것이 우선, 없으면 tmux pane, 그다음 데스크톱 같은 다른 세션
export function controlRowOf(c: ControlSession): ControlRow {
  const bg = c.live.find((l) => l.kind === "background" && l.id);
  const tmux = bg ? undefined : c.live.find((l) => l.tmux);
  const other = c.live.find((l) => l !== bg);
  const badge = bg ? `BG ${bg.id}` : tmux ? `tmux ${tmux.tmux}` : other ? "interactive" : "not running";
  const tone: ControlBadgeTone = bg || tmux ? "busy" : other ? "other" : "dead";
  const detail = bg
    ? (bg.status ?? null)
    : tmux
      ? ([tmux.name ?? tmux.kind, tmux.status].filter(Boolean).join(" · ") || null)
      : other
        ? `${other.name ?? other.kind} · 데스크톱 세션은 그 창에서 닫는다`
        : null;
  const action: ControlAction = c.launch === null ? null : bg || tmux ? { kind: "stop", tmux: tmux?.tmux ?? null } : { kind: "launch", disabled: Boolean(other) || Boolean(c.blocked), title: c.blocked };
  const job = bg?.job ?? null;
  return {
    name: c.name,
    dir: c.dir ? `${c.dir}/` : "저장소 뿌리",
    badge,
    tone,
    detail,
    how: c.launch === "bg" ? (tmux ? "tmux에서 연 세션" : "claude --bg") : null,
    action,
    needs: job?.state === "blocked" ? job : null,
    working: job?.state === "working" && job.detail ? job : null,
    launchOff: c.blocked && c.launch !== null ? c.blocked : null,
    stale: (c.stale ?? []).map((x) => x.id ?? "").filter(Boolean),
  };
}
