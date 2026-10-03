import type { QueueInput, QueueItem } from "./supervisor-queue.ts";

// LEAK COUNTER(ATC-363, docs/autonomy.md 3절 원칙 1·4절): 릴리스 뒤에도 사람이 거치는 단계(leak)를 센다. 세기만 하고 게이트는 바꾸지 않는다.
// 큐 항목마다 leak인지 exempt인지, 어느 gate 행(autonomy.md 4절)인지 정한다. leak은 열릴 때와 닫힐 때만 한 줄씩 남긴다(주기마다 아님).
// 순수 함수만. 자료 모으기와 파일은 leaks-run.ts.

export type LeakWhy = "user" | "check" | "escalate" | "hold" | "mode" | "tier-unknown" | "teams-merge-off" | "autoland";

// 큐 항목 + 분류에 필요한 덤. 큐 자체(QueueItem)는 건드리지 않고 leaks-run이 덧붙인다
export interface LeakItem extends Omit<QueueItem, "primary" | "flight"> {
  flight?: string | null;
  landWhy?: LeakWhy | null; // LANDING: SUPERVISOR가 착륙시키는 이유(land-by.ts)
  prompt?: boolean; // NEEDS YOU: 도구 승인 프롬프트(needs가 "approve …")
  raisedBy?: "breaker" | null; // 차단기(autonomy.md C6)가 올린 항목. 아직 없는 장치라 늘 null
}

// 4절 gate 행을 대신할 통제(5절 C번호). built는 그 통제가 지금 돌고 있나. 통제가 서면 여기만 true로 고친다
export interface Control {
  id: string;
  built: boolean;
}
export const CONTROLS = {
  C9: { id: "C9", built: false },
  C10: { id: "C10", built: false },
  C11: { id: "C11", built: false },
  C13: { id: "C13", built: false },
  C14: { id: "C14", built: false },
  C15: { id: "C15", built: false },
  RTS: { id: "RTS", built: true }, // RTS 건강 검사와 ROLLBACK(이미 있다). D1은 이것이 있어 사람이 기다릴 이유가 없다
} as const satisfies Record<string, Control>;

export type ExemptReason = "K1" | "K2" | "K3" | "brake" | "breaker" | "signal";
export type Verdict = { leak: true; gate: string; control: Control } | { leak: false; reason: ExemptReason; gate: string | null };

const leak = (gate: string, control: keyof typeof CONTROLS): Verdict => ({ leak: true, gate, control: CONTROLS[control] });
const exempt = (reason: ExemptReason, gate: string | null): Verdict => ({ leak: false, reason, gate });

// 큐 항목 하나가 leak인가 exempt인가, 어느 gate 행인가. 면제: K1~K3 승인, SUPERVISOR가 당긴 brake, 차단기가 올린 항목
export function classify(i: LeakItem): Verdict {
  if (i.raisedBy === "breaker") return exempt("breaker", null);
  switch (i.kind) {
    case "PROPOSAL":
      return i.title.startsWith("LAUNCH") ? leak("P2", "C11") : leak("P1", "C14");
    case "SCHEDULE":
      return leak("P5", "C14");
    case "FLEET PLAN":
      return leak("P3", "C14");
    case "HUMAN CHECK":
      return leak("L10", "C10");
    case "LANDING":
      if (i.landWhy === "hold") return exempt("brake", "L20");
      // user 등급: 보수적으로 K3 승인으로 본다(L13의 package*.json은 가르지 못한다). check: K 승인 검사 자체를 바꾸는 PR(ATC-391)도 K3다
      if (i.landWhy === "user" || i.landWhy === "check") return exempt("K3", "L14");
      if (i.landWhy === "escalate") return leak("L11", "C13");
      return leak("L14", "C9"); // mode·tier-unknown·teams-merge-off·autoland: 사람이 머지 단추를 누른다
    case "UPDATE":
      return leak("D1", "RTS");
    case "NEEDS YOU":
      return i.prompt ? exempt("K3", "P7") : leak("P7", "C9");
    case "RELAY":
      return leak("L18", "C15");
    case "UNDELIVERED":
      return leak("P6", "C14");
    case "BACKLOG":
      return leak("P16", "C14"); // 제안이 SUPERVISOR의 발권을 기다린다(ATC-401). 센다: 기다림이 보이게
    case "GO":
      return exempt("K3", "P8");
    case "DECISION":
      return exempt("K3", null); // K1~K3 결정만 카드가 된다(ATC-352): 사람이 정하는 일이라 leak이 아니다
    // HOME의 한 목록에 더한 종류(ATC-454)는 승인 단계가 아니라 SUPERVISOR가 읽는 신호다. 통제로 없앨 사람의 한 걸음이 아니므로 leak으로 세지 않는다
    case "ALERT":
    case "STUCK":
    case "EFFECT":
    case "CLOSE":
    case "ARRIVED":
      return exempt("signal", null);
  }
}

// ── 기록 ──
export interface LeakOpen {
  v: 1;
  t: string; // 이 줄을 쓴 시각
  ev: "open";
  id: string; // `${kind}|${key}`
  kind: string;
  gate: string;
  control: string;
  controlBuilt: boolean;
  title: string;
  flight: string | null;
  release: string | null; // 붙잡힌 FLIGHT의 발권 기록 id(release.ts releaseIdOf, ATC-402). 발권되지 않은 일이면 null
  since: string; // 사람이 기다리기 시작한 시각(큐의 since, 모르면 처음 본 시각)
}
export interface LeakClose {
  v: 1;
  t: string;
  ev: "close";
  id: string;
  since: string;
  heldMin: number;
}
export type LeakRecord = LeakOpen | LeakClose;

export const leakId = (i: Pick<QueueItem, "kind" | "key">) => `${i.kind}|${i.key}`;
const MIN = 60_000;

// 열린 leak 한 건의 메모리 상태. misses는 연달아 큐에서 안 보인 주기 수
export interface OpenLeak {
  rec: LeakOpen;
  lastSeen: number;
  misses: number;
}
// 스냅샷이 잠깐 비어도(GitHub 지연) 닫고 다시 열어 두 번 세지 않게, 연달아 두 번 안 보일 때만 닫는다
export const CLOSE_AFTER_MISSES = 2;

// 주기 하나: 지금의 큐와 열린 leak을 맞춘다. 바뀐 만큼만 줄을 돌려준다(없으면 빈 배열).
// ready가 false면(입력이 아직 없다: RTS 재시작 직후 첫 스냅샷에 PR이 없음 등, ATC-385) 큐가 비어 보이는 것이 사실이 아니다:
// 열린 leak은 계속 기다리는 중이라 지금 본 것으로 치고(분이 이어진다) 아무것도 열거나 닫지 않는다. 입력이 돌아오면 한 번의 기다림이 한 leak으로 이어진다
export function reconcile(open: Map<string, OpenLeak>, items: readonly LeakItem[], now: number, ready = true, releaseOf: (flight: string | null) => string | null = () => null): LeakRecord[] {
  if (!ready) {
    for (const o of open.values()) {
      o.lastSeen = now;
      o.misses = 0;
    }
    return [];
  }
  const out: LeakRecord[] = [];
  const seen = new Set<string>();
  for (const i of items) {
    const v = classify(i);
    if (!v.leak) continue;
    const id = leakId(i);
    seen.add(id);
    const cur = open.get(id);
    if (cur) {
      cur.lastSeen = now;
      cur.misses = 0;
      continue;
    }
    const rec: LeakOpen = {
      v: 1,
      t: new Date(now).toISOString(),
      ev: "open",
      id,
      kind: i.kind,
      gate: v.gate,
      control: v.control.id,
      controlBuilt: v.control.built,
      title: i.title,
      flight: i.flight ?? null,
      release: releaseOf(i.flight ?? null), // 붙잡힌 FLIGHT의 발권 id(ATC-402). 발권 기록이 없으면 null
      since: i.since ?? new Date(now).toISOString(),
    };
    open.set(id, { rec, lastSeen: now, misses: 0 });
    out.push(rec);
  }
  for (const [id, o] of [...open]) {
    if (seen.has(id)) continue;
    if (++o.misses < CLOSE_AFTER_MISSES) continue;
    open.delete(id);
    out.push({ v: 1, t: new Date(now).toISOString(), ev: "close", id, since: o.rec.since, heldMin: Math.max(0, Math.round((o.lastSeen - Date.parse(o.rec.since)) / MIN)) });
  }
  return out;
}

// 줄들에서 아직 안 닫힌 leak을 되살린다(서버 재시작). lastSeen은 지금으로 둔다
export function openFromRecords(recs: readonly LeakRecord[], now: number): Map<string, OpenLeak> {
  const m = new Map<string, OpenLeak>();
  for (const r of recs) {
    if (r.ev === "open") m.set(r.id, { rec: r, lastSeen: now, misses: 0 });
    else m.delete(r.id);
  }
  return m;
}

// ── 화면 ──
export interface LeakKindRow {
  kind: string;
  gate: string;
  control: string;
  controlBuilt: boolean;
  count: number; // 창 안에 열린 leak
  openNow: number;
  heldMin: number; // 닫힌 것의 대기 분 + 열린 것의 지금까지 분
  work: string[]; // 붙잡힌 일(FLIGHT, 없으면 title), 중복 없이 최대 MAX_WORK
}
export interface LeakView {
  v: 1;
  at: string;
  days: number;
  exists: LeakKindRow[]; // 통제가 있다
  missing: LeakKindRow[]; // 통제가 없다
  totals: { count: number; heldMin: number; openNow: number };
}
const MAX_WORK = 5;

export function leakView(recs: readonly LeakRecord[], now: number, days = 7): LeakView {
  const since = now - days * 86_400_000;
  // 같은 기다림(id와 since가 같음)은 한 leak이다: 입력이 잠깐 끊겨 닫혔다 다시 열린 줄(옛 기록 포함)도 하나로 센다(ATC-385).
  // 줄 순서대로 마지막 상태를 본다: 닫혔으면 그 heldMin, 다시 열렸으면 지금까지
  const waits = new Map<string, { open: LeakOpen; heldMin: number | null }>();
  for (const r of recs) {
    if (r.ev === "open") {
      const k = `${r.id}|${r.since}`;
      const w = waits.get(k);
      if (w) w.heldMin = null;
      else waits.set(k, { open: r, heldMin: null });
    } else {
      const w = waits.get(`${r.id}|${r.since}`);
      if (w) w.heldMin = r.heldMin;
    }
  }
  const rows = new Map<string, LeakKindRow>();
  const works = new Map<string, Set<string>>();
  for (const { open: r, heldMin } of waits.values()) {
    if (Date.parse(r.t) < since) continue;
    const key = `${r.kind}|${r.gate}|${r.control}`;
    let row = rows.get(key);
    if (!row) {
      row = { kind: r.kind, gate: r.gate, control: r.control, controlBuilt: r.controlBuilt, count: 0, openNow: 0, heldMin: 0, work: [] };
      rows.set(key, row);
      works.set(key, new Set());
    }
    row.count++;
    if (heldMin !== null) row.heldMin += heldMin;
    else {
      row.openNow++;
      row.heldMin += Math.max(0, Math.round((now - Date.parse(r.since)) / MIN));
    }
    works.get(key)!.add(r.flight ?? r.title);
  }
  for (const [k, row] of rows) row.work = [...works.get(k)!].slice(0, MAX_WORK);
  const all = [...rows.values()].sort((a, b) => b.heldMin - a.heldMin || a.kind.localeCompare(b.kind));
  return {
    v: 1,
    at: new Date(now).toISOString(),
    days,
    exists: all.filter((r) => r.controlBuilt),
    missing: all.filter((r) => !r.controlBuilt),
    totals: { count: all.reduce((n, r) => n + r.count, 0), heldMin: all.reduce((n, r) => n + r.heldMin, 0), openNow: all.reduce((n, r) => n + r.openNow, 0) },
  };
}

// ── 큐 항목에 분류용 덤을 붙인다(FLIGHT, 착륙 이유, 승인 프롬프트) ──
const repoName = (repo: string) => repo.replace(/\/+$/, "").split("/").pop() || repo;
export function leakItemsOf(items: readonly QueueItem[], inp: QueueInput): LeakItem[] {
  const prop = new Map(inp.proposals.map((p) => [p.id, p]));
  const op = new Map(inp.schedule.ops.map((o) => [o.id, o]));
  const sess = new Map(inp.sessions.map((s) => [s.id, s]));
  const pr = new Map(inp.pulls.map((p) => [`${repoName(p.repo)}#${p.number}@${p.head}`, p]));
  return items.map((i): LeakItem => {
    switch (i.kind) {
      case "PROPOSAL":
      case "GO":
        return { ...i, flight: prop.get(i.key)?.flight ?? null };
      case "BACKLOG":
        return { ...i, flight: i.key };
      case "UNDELIVERED":
        return { ...i, flight: i.hand?.source === "FLIGHT PLAN" ? (prop.get(i.hand.id)?.flight ?? null) : null };
      case "SCHEDULE":
        return { ...i, flight: op.get(i.key)?.flight ?? null };
      case "HUMAN CHECK":
        return { ...i, flight: pr.get(i.key)?.ticketKey ?? null };
      case "LANDING": {
        const p = pr.get(i.key);
        return { ...i, flight: p?.ticketKey ?? null, landWhy: p?.landWhy ?? null };
      }
      case "RELAY":
        return { ...i, flight: i.offer?.flight ?? null };
      case "NEEDS YOU":
        return { ...i, prompt: /^approve\b/i.test(sess.get(i.key)?.job?.needs ?? sess.get(i.key)?.job?.pendingNeeds ?? "") };
      default:
        return { ...i };
    }
  });
}
