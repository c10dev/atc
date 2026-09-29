import { loopIntervalOf } from "./control-strip.ts";
import { type ContextBadge, contextBadgeOf, type ContextView } from "./fuel-context.ts";
import type { Job } from "./job-state.ts";
import { originBadgeOf, type SessionOrigin } from "./session-origin.ts";

// FLEET 탭 CONTROL SESSIONS 구역의 계산(ATC-130). 줄마다 live 배지와 버튼, 새로 읽는 간격. 화면(web/src/views/fleet/ControlSessions.tsx)은 이 결과를 그리기만 한다.
// API(/api/control/sessions)와 그 모양은 그대로다(docs/fleet.md 8.5.1).
export type ControlLive = { id?: string; name?: string; kind: string; status?: string; tmux?: string; job?: Job | null };
// SQUELCH의 마지막 판정(ATC-127, 헤더 CONTROL 띠): 마지막 tick 시각과 마지막 OPEN 뒤 QUIET 수. 옛 서버 응답이나 SQUELCH 기록이 없으면 없다
export type SquelchLast = { lastAt: string; open: boolean; reason: string; openedAt: string | null; quietSince: string | null; quietCount: number };
export type ControlSession = { name: string; dir: string | null; prompt: string | null; launch: "bg" | null; blocked: string | null; live: ControlLive[]; stale?: { id?: string; name?: string }[]; squelch?: SquelchLast | null };
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
  working: Job | null; // job이 working이고 detail이 있거나 blocked에서 고쳐 보인 것이면 그 한 줄
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
    working: job?.state === "working" && (job.detail || job.settled) ? job : null,
    launchOff: c.blocked && c.launch !== null ? c.blocked : null,
    stale: (c.stale ?? []).map((x) => x.id ?? "").filter(Boolean),
  };
}

// ── FLEET의 CONTROL 그룹: AIRCRAFT 목록과 같은 줄(ATC-132) ──
// 줄의 값은 API(/api/control/sessions)와 snapshot(마지막 활동·origin·permission mode)과 /api/fuel의 그 이름 줄에서 온다. 없으면 `—`(0이 아니다).
export type ControlStatus = "BUSY" | "IDLE" | "NEEDS YOU" | "NOT RUNNING";
export type ControlAccountRow = { name: string; label: string | null; account: string | null };
export interface ControlSessionInfo {
  lastActiveAt: string | null;
  permissionMode: string | null;
  origin?: SessionOrigin | null;
}
// /api/fuel의 aircraft[]에서 그 세션 이름(대문자) 줄
export interface ControlFuelInfo {
  cost: number | null; // 최근 14일 FUEL COST(USD). 값 매긴 요청이 없으면 null
  requests: number;
  models: Record<string, number>; // 모델 → 요청 수
  context: ContextView | null;
}
export interface ControlExtras {
  account?: ControlAccountRow | null;
  session?: ControlSessionInfo | null;
  fuel?: ControlFuelInfo | null;
}

// 상태의 색은 AIRCRAFT 줄과 같은 st-* 클래스를 쓴다: BUSY는 AIRBORNE, IDLE은 HOLDING, NOT RUNNING은 NOT IN SERVICE, NEEDS YOU는 따로
export const CONTROL_STATUS_CLASS: Record<ControlStatus, string> = { BUSY: "st-AIRBORNE", IDLE: "st-HOLDING", "NEEDS YOU": "st-NEEDS-YOU", "NOT RUNNING": "st-NOT-IN-SERVICE" };

const BUSY_WORDS = /busy|working|running|active/i;
// 살아 있으면 job이 blocked일 때 NEEDS YOU, 일하는 중이면 BUSY, 아니면 IDLE. 살아 있는 세션이 없으면 NOT RUNNING
export function controlStatusOf(r: { tone: ControlBadgeTone; needs: unknown; liveStatus: string | null; jobState: string | null }): ControlStatus {
  if (r.tone === "dead") return "NOT RUNNING";
  if (r.needs) return "NEEDS YOU";
  return r.jobState === "working" || (r.liveStatus !== null && BUSY_WORDS.test(r.liveStatus)) ? "BUSY" : "IDLE";
}

// 모델 이름 → 짧은 계열: claude-sonnet-5-5 → Sonnet. 모르면 이름 그대로
export const modelFamilyOf = (model: string): string => {
  const m = /(opus|sonnet|haiku|fable)/i.exec(model);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : model;
};
// 요청이 가장 많은 모델의 계열. 없으면 null
export function dominantModelOf(models: Record<string, number> | null | undefined): string | null {
  const top = Object.entries(models ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return top ? modelFamilyOf(top[0]) : null;
}

// 최근 14일 비용 한 칸: `$1.23`. 기록이 없거나 값 매긴 요청이 없으면 null(칸에는 `—`)
export function controlFuelOf(f: ControlFuelInfo | null | undefined): { label: string; title: string } | null {
  if (!f || f.requests <= 0 || f.cost === null || !Number.isFinite(f.cost)) return null;
  const label = `$${f.cost.toFixed(2)}`;
  return { label, title: `최근 14일 FUEL COST ${label} · 요청 ${f.requests}건` };
}

export interface ControlRow2 extends ControlRow {
  status: ControlStatus;
  statusClass: string;
  liveStatus: string | null;
  flying: { text: string; title: string } | null; // 칸에는 NEEDS YOU 칩이나 job detail이 온다. 이것은 잘릴 때의 툴팁 글
  intervalMin: number | null; // 첫 메시지 `/loop 3m /tick`의 3
  lastActiveAt: string | null;
  fob: ContextBadge | null;
  fuel: { label: string; title: string } | null;
  account: string | null; // 실제로 세는 ACCOUNT(라벨, 없으면 AIRCRAFT에서 따온 것)
  method: string | null; // 띄운 방식(claude --bg | tmux에서 연 세션). launch가 없는 줄은 null
  permission: string | null;
  model: string | null; // 그 세션이 실제로 쓴 모델 계열(FUEL 기록), 모르면 null
  origin: ReturnType<typeof originBadgeOf>; // AIRCRAFT 줄과 같은 칩(BG·TERM·DESKTOP)
  accountDiffers: boolean; // 그룹의 ACCOUNT와 다를 때만 줄에 칩
  methodDiffers: boolean;
  permissionDiffers: boolean;
  startsOpen: boolean; // NEEDS YOU는 펼친 채로 시작
  dirShort: string | null; // 접힌 줄에 적는 폴더. 이름과 같은 폴더(crosscheck/)는 뺀다 — 펼친 곳에 dir이 있다
}

// 한 줄(ATC-132). 그룹과 비교하는 differs 표시는 controlGroupOf가 채운다
export function controlRow2Of(c: ControlSession, x: ControlExtras = {}): ControlRow2 {
  const r = controlRowOf(c);
  const bg = c.live.find((l) => l.kind === "background" && l.id);
  const tmux = bg ? undefined : c.live.find((l) => l.tmux);
  const other = c.live.find((l) => l !== bg);
  const liveStatus = bg?.status ?? tmux?.status ?? other?.status ?? null;
  const status = controlStatusOf({ tone: r.tone, needs: r.needs, liveStatus, jobState: (bg?.job ?? null)?.state ?? null });
  const originKind: SessionOrigin | null = bg ? "background" : tmux ? "terminal" : other ? (x.session?.origin ?? "desktop") : null;
  const job = r.needs ?? r.working;
  const flyingText = r.needs ? [r.needs.needs, r.needs.detail].filter(Boolean).join(" — ") || "NEEDS YOU" : (r.working?.detail ?? "");
  const permission = x.session?.permissionMode ?? null;
  return {
    ...r,
    status,
    statusClass: CONTROL_STATUS_CLASS[status],
    liveStatus,
    flying: job && flyingText ? { text: flyingText, title: flyingText } : null,
    intervalMin: loopIntervalOf(c.prompt),
    lastActiveAt: x.session?.lastActiveAt ?? null,
    fob: contextBadgeOf(x.fuel?.context ?? null),
    fuel: controlFuelOf(x.fuel),
    account: x.account ? (x.account.label ?? x.account.account) : null,
    method: r.how,
    permission,
    model: dominantModelOf(x.fuel?.models),
    origin: originKind ? originBadgeOf(originKind, permission, bg?.id ?? null) : null,
    accountDiffers: false,
    methodDiffers: false,
    permissionDiffers: false,
    startsOpen: status === "NEEDS YOU",
    dirShort: c.dir && c.dir.toLowerCase() === c.name.toLowerCase() ? null : r.dir,
  };
}

export interface ControlGroup {
  count: number;
  method: string | null; // 모두(살아 있는 줄이 아니라 launch가 있는 줄 모두) 같으면 그 값, 섞이면 가장 흔한 값
  permission: string | null;
  account: string | null;
  models: { label: string; names: string[] }[]; // 계열별 세션(이름 순). 아무 줄도 모르면 빈 목록
  notRunning: number;
  needsYou: number;
  daemonInService: boolean;
}

// 가장 흔한 값(같은 수면 먼저 나온 값). 값이 없으면 null
export function commonOf(values: readonly (string | null | undefined)[]): string | null {
  const count = new Map<string, number>();
  for (const v of values) if (v) count.set(v, (count.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [v, k] of count) if (k > n) (best = v), (n = k);
  return best;
}

// 그룹 머리에 한 번만 적는 공통 사실과, 줄마다 그것과 다른지. 줄은 다른 값이 있을 때만 그 칩을 보인다
export function controlGroupOf(rows: readonly ControlRow2[], daemonInService = false): { group: ControlGroup; rows: ControlRow2[] } {
  const method = commonOf(rows.map((r) => r.method));
  const permission = commonOf(rows.map((r) => r.permission));
  const account = commonOf(rows.map((r) => r.account));
  const byModel = new Map<string, string[]>();
  for (const r of rows) if (r.model) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r.name]);
  const models = [...byModel].map(([label, names]) => ({ label, names })).sort((a, b) => b.names.length - a.names.length || a.label.localeCompare(b.label));
  return {
    rows: rows.map((r) => ({
      ...r,
      accountDiffers: r.account !== null && r.account !== account,
      methodDiffers: r.method !== null && method !== null && r.method !== method,
      permissionDiffers: r.permission !== null && permission !== null && r.permission !== permission,
    })),
    group: {
      count: rows.length,
      method,
      permission,
      account,
      models,
      notRunning: rows.filter((r) => r.status === "NOT RUNNING").length,
      needsYou: rows.filter((r) => r.status === "NEEDS YOU").length,
      daemonInService,
    },
  };
}

// 폴더 설정이 정하는 모델(FUEL 기록이 아직 없을 때 머리에 적는 안내)
export const CONTROL_MODEL_NOTE = "model: TOWER·OCC·REVIEW Sonnet, MCC·CROSSCHECK Opus";

// 그룹 머리의 한 줄 조각들: `claude --bg`, `auto`, `acct-2`, `model: TOWER·OCC·REVIEW Sonnet, MCC·CROSSCHECK Opus`. 모르는 조각은 빠진다
export function controlGroupFacts(g: ControlGroup): string[] {
  const model = g.models.length === 1 && g.models[0].names.length === g.count ? `model: ${g.models[0].label}` : g.models.length ? `model: ${g.models.map((m) => `${m.names.join("·")} ${m.label}`).join(", ")}` : CONTROL_MODEL_NOTE;
  return [g.method, g.permission, g.account, model].filter((x): x is string => Boolean(x));
}

// FLEET에 ACCOUNT를 보이는 곳은 하나다(ATC-132): FUEL ACCOUNT 블록(구성원·쓴 몫·효과). FLEET PLAN의 같은 글은 FLEET 응답에 fuelAccounts가 없는 옛 서버일 때만 대신 보인다
export type AccountView = "fuel" | "plan" | null;
export function accountViewOf(fleetAccounts: readonly unknown[] | null | undefined, planAccounts: readonly unknown[] | null | undefined): AccountView {
  if (fleetAccounts && fleetAccounts.length > 0) return "fuel";
  if (fleetAccounts === undefined || fleetAccounts === null) return planAccounts && planAccounts.length > 0 ? "plan" : null;
  return null; // 응답이 있고 비었으면 보일 ACCOUNT가 없다
}
// hold 수준이 되면 DISPATCH가 무엇을 하나(FLEET PLAN 줄에 있던 글). ok는 없음
export const ACCOUNT_EFFECT: Record<"ok" | "info" | "hold", string | null> = { ok: null, info: "제안에 FUEL 사유 줄", hold: "LAUNCH·ENTRY 제안 안 함" };
