import type { ApplyTarget } from "./apply-now.ts";

// CONTROL SESSIONS 일괄 동작(ATC-255, docs/fleet.md 8.5.2): LAUNCH ALL · RESTART ALL · STOP ALL · ALIGN. 계획은 이 파일(순수).
// 입출력은 control-bulk-run.ts. 여기는 사실을 받아 순서·행동·ACCOUNT drift·이유가 담긴 행을 돌려주기만 한다. 새로 세션을 멈추는 길은 없다:
// 실행은 늘 FLEET의 LAUNCH·STOP 버튼과 CONTROL RECYCLE이 쓰는 같은 함수(launchControl·stopControl·performRecycle)다. guard는 그대로.

export const BULK_OPS = ["launch", "restart", "stop", "align"] as const;
export type BulkOp = (typeof BULK_OPS)[number];
export const bulkOpOk = (v: unknown): v is BulkOp => (BULK_OPS as readonly unknown[]).includes(v);
export const BULK_LABEL: Record<BulkOp, string> = { launch: "LAUNCH ALL", restart: "RESTART ALL", stop: "STOP ALL", align: "ALIGN" };

export type BulkAction = "launch" | "stop" | "restart" | "skip";
// 지금 떠 있는 모양: bg는 atc가 띄운 claude --bg, tmux는 pane(STOP만 된다), other는 데스크톱·터미널(atc가 못 다룬다)
export type BulkLive = "background" | "tmux" | "other" | null;

export interface BulkSession {
  name: string;
  live: BulkLive;
  current: string | null; // 지금 도는 세션의 ACCOUNT(관찰한 것)
  intended: string | null; // 지금 LAUNCH하면 쓸 ACCOUNT(LAUNCH ACCOUNT → 관제 세션 라벨 → default). 등록부가 없으면 null
  blocks: string[]; // 지금 멈추면 잃는 것(턴 도중, RTS·TOWER·OCC·MCC 안전 조건). 비면 안전
}

export interface BulkRow {
  order: number; // 1부터. LAUNCH·RESTART·ALIGN은 이 순서로, STOP은 거꾸로 실행한다
  name: string;
  action: BulkAction;
  from: string | null;
  to: string | null;
  drift: boolean; // 도는 세션의 ACCOUNT가 intended와 다르다
  reason: string;
  blocks: string[]; // 비어 있지 않으면 held: 그냥은 하지 않고 force일 때만 한다(LAUNCH는 막을 것이 없다)
}

// PILOT'S DISCRETION: TOWER를 먼저(다른 관제 세션과 팀의 CLEARANCE·GO AROUND가 TOWER로 모인다), 이어 OCC(FLIGHT PLAN), MCC, CROSSCHECK, REVIEW(검증 쪽).
// CONTROL_SESSIONS의 선언 순서와 같고, STOP은 그 반대로 검증 쪽부터 내린다
export const BULK_ORDER = ["TOWER", "OCC", "MCC", "CROSSCHECK", "REVIEW"] as const;
export const orderOf = (name: string): number => {
  const i = (BULK_ORDER as readonly string[]).indexOf(name.toUpperCase());
  return i < 0 ? BULK_ORDER.length + 1 : i + 1;
};

export interface BulkInputs {
  op: BulkOp;
  sessions: readonly BulkSession[];
  targets: readonly ApplyTarget[]; // ACCOUNT마다 로그인·FUEL hold·상한(apply-now와 같은 모양)
}

// 지금 LAUNCH하면 쓸 ACCOUNT(순수, session-control.ts launchAccountOf와 같은 순서): LAUNCH ACCOUNT(control) → 관제 세션 라벨 → default 폴더.
// 등록부가 비면 null(ACCOUNT를 가리지 않는다). 등록부에 없는 라벨은 무시한다
export function intendedAccountOf(i: { labels: readonly string[]; defaultLabel: string | null; preferred: string | null | undefined; home: string | null | undefined }): string | null {
  if (!i.labels.length) return null;
  const pick = (l: string | null | undefined) => (l && i.labels.includes(l.toLowerCase()) ? l.toLowerCase() : null);
  return pick(i.preferred) ?? pick(i.home) ?? i.defaultLabel;
}

export const driftOf = (s: Pick<BulkSession, "live" | "current" | "intended">): boolean => s.live === "background" && s.current !== null && s.intended !== null && s.current !== s.intended;

export function bulkPlanOf(i: BulkInputs): BulkRow[] {
  const planned = new Map<string, number>(); // 목표마다 이번 계획이 새로 얹는 세션 수(ACCOUNT 상한)
  const sessions = [...i.sessions].sort((a, b) => orderOf(a.name) - orderOf(b.name));
  const out: BulkRow[] = [];
  const target = (label: string) => i.targets.find((t) => t.label === label) ?? null;
  // 목표 ACCOUNT가 받지 않는 이유(없으면 null). delta: 이 행이 그 ACCOUNT에 새로 얹는 백그라운드 세션 수
  const refusal = (to: string | null, delta: number): string | null => {
    if (!to || !i.targets.length) return null;
    const t = target(to);
    if (!t) return `ACCOUNT ${to}가 등록부에 없음`;
    if (t.refused) return `ACCOUNT ${to}: ${t.refused}`;
    if (delta > 0 && t.maxLaunched && t.running + (planned.get(to) ?? 0) + delta > t.maxLaunched) return `ACCOUNT ${to}: 상한 ${t.maxLaunched} 찼음`;
    return null;
  };
  for (const s of sessions) {
    const drift = driftOf(s);
    const row = (action: BulkAction, reason: string, blocks: string[] = [], to: string | null = s.intended): BulkRow => ({ order: orderOf(s.name), name: s.name, action, from: s.current, to, drift, reason, blocks });
    const skip = (reason: string) => out.push(row("skip", reason, [], s.intended));
    const add = (to: string | null, delta: number) => to && planned.set(to, (planned.get(to) ?? 0) + delta);

    // 켜는 행동(launch): 떠 있지 않은 세션
    const launchRow = (why: string) => {
      const no = refusal(s.intended, 1);
      if (no) return skip(no);
      add(s.intended, 1);
      out.push(row("launch", why));
    };
    // 다시 띄우는 행동(restart): claude --bg로 도는 세션. 같은 ACCOUNT면 상한에 얹는 것이 없다
    const restartRow = (why: string) => {
      const delta = s.current === s.intended ? 0 : 1;
      const no = refusal(s.intended, delta);
      if (no) return skip(no);
      add(s.intended, delta);
      out.push(row("restart", why, s.blocks));
    };

    if (i.op === "launch") {
      if (s.live === null) launchRow("떠 있지 않음");
      else skip(s.live === "background" ? "이미 떠 있음" : s.live === "tmux" ? "이미 떠 있음(tmux pane)" : "데스크톱·터미널 세션이 떠 있음 — 그 창에서 다룬다");
    } else if (i.op === "stop") {
      if (s.live === "background" || s.live === "tmux") out.push(row("stop", s.live === "tmux" ? "tmux pane만 닫는다" : "claude stop", s.blocks, null));
      else skip(s.live === null ? "떠 있지 않음" : "데스크톱·터미널 세션 — atc가 멈추지 않는다(그 창에서 닫는다)");
    } else if (i.op === "restart") {
      if (s.live === null) launchRow("떠 있지 않음 — 그대로 LAUNCH(모두 떠 있게)");
      else if (s.live === "background") restartRow(drift ? `STOP → LAUNCH · ACCOUNT ${s.current} → ${s.intended}` : "STOP → LAUNCH");
      else skip(s.live === "tmux" ? "tmux 세션 — atc가 다시 띄울 수 없다(STOP ALL로 닫고 LAUNCH)" : "데스크톱·터미널 세션 — atc가 다시 띄울 수 없다");
    } else {
      // align: ACCOUNT가 어긋난 세션만 intended로 옮긴다
      if (s.live === "background" && drift) restartRow(`ACCOUNT ${s.current} → ${s.intended}`);
      else if (s.live === "background") skip(s.intended === null ? "ACCOUNT 등록부 없음 — 어긋날 것이 없다" : `ACCOUNT 맞음(${s.current ?? "?"})`);
      else skip(s.live === null ? "떠 있지 않음 — LAUNCH ALL이 intended ACCOUNT로 띄운다" : "claude --bg 세션이 아님 — atc가 옮길 수 없다");
    }
  }
  return out;
}

// 실행 순서: STOP은 거꾸로. 한 줄이라도 held(blocks)면 force 없이는 하지 않는다
export function bulkRunOrderOf(op: BulkOp, rows: readonly BulkRow[]): BulkRow[] {
  const todo = rows.filter((r) => r.action !== "skip");
  return op === "stop" ? [...todo].reverse() : todo;
}
export const heldOf = (r: Pick<BulkRow, "action" | "blocks">): boolean => r.action !== "skip" && r.action !== "launch" && r.blocks.length > 0;

// 화면이 본 계획과 지금 계획이 같은 행동인가: 계획이 바뀌었으면 그 세션은 하지 않고 다시 미리 본다. expect는 { 이름: 행동 }
export function expectMismatch(rows: readonly BulkRow[], expect: Readonly<Record<string, unknown>>): string[] {
  return rows.filter((r) => r.action !== "skip" && expect[r.name] !== r.action).map((r) => r.name);
}

// ── 결과 ──
export interface BulkResult {
  name: string;
  action: BulkAction;
  ok: boolean;
  held?: boolean; // 안전 조건 때문에 하지 않음(force가 아니었음)
  skipped?: string; // 하지 않은 이유(계획이 바뀜, 앞에서 실패해 멈춤)
  error?: string;
  jobId?: string;
  from?: string | null;
  to?: string | null;
}
export function bulkCountsOf(results: readonly BulkResult[]) {
  const done = results.filter((r) => !r.held && !r.skipped);
  return { done: done.filter((r) => r.ok).length, failed: done.filter((r) => !r.ok).length, held: results.filter((r) => r.held).length, skipped: results.filter((r) => r.skipped && !r.held).length };
}

// ── 복구 배너(모두 내려가 있을 때) ──
// LAUNCH할 수 있는 관제 세션이 하나도 떠 있지 않다(예: 호스트 재부팅 뒤). 목록을 못 읽었거나 아직 없으면 거짓(모르는 것을 내려갔다고 하지 않는다)
export function allControlDown(sessions: readonly { launch: "bg" | null; live: readonly unknown[] }[] | null | undefined): boolean {
  const mine = (sessions ?? []).filter((s) => s.launch === "bg");
  return mine.length > 0 && mine.every((s) => s.live.length === 0);
}
