// DISPATCH·SCHEDULE READINESS 한 줄(ATC-113)과 맨 위에 남기는 예외의 판정. 브리프를 받아 조각만 만드는 순수 함수라
// 화면 없이 테스트한다(server/readiness-line.test.ts). 옛 서버가 필드를 빠뜨려도 그 조각만 빼고 계속 만든다.
// 게이트 규칙은 바꾸지 않는다 — 각 블록이 보여 주던 판정(충족·미달·데이터 부족)을 그대로 한 조각으로 접을 뿐이다.

export type PartState = "ok" | "bad" | "info";
export interface LinePart {
  id: string;
  label: string;
  value: string;
  mark: "✓" | "✗" | null; // 색만으로 전하지 않게 기호를 같이 쓴다
  state: PartState;
}

interface RateIn {
  matched?: number;
  marked?: number;
  rate?: number | null;
}
interface GateIn {
  decided?: number;
  agreement?: number | null;
  target?: { decided: number; agreement: number };
  crosscheck?: RateIn;
}
export interface DispatchLineIn {
  mode?: string;
  readiness2b?: { items?: { status?: string }[] };
  gate?: GateIn;
  gate3?: { dispatched?: number; ready?: boolean; target?: { dispatched: number } };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const part = (id: string, label: string, value: string, state: PartState, mark: LinePart["mark"] = null): LinePart => ({ id, label, value, mark, state });

// gate·agree·CROSSCHECK: DISPATCH와 SCHEDULE이 같다. Gate 블록의 판정(판정 건수 ≥ 기준, 합의율 ≥ 기준, 5건 미만은 데이터 부족)과 같은 기준
function gateParts(gate: GateIn | undefined): LinePart[] {
  if (!gate) return [];
  const out: LinePart[] = [];
  const t = gate.target;
  if (isNum(gate.decided)) {
    const enough = t ? gate.decided >= t.decided : null;
    out.push(part("gate", "gate", t ? `${gate.decided}/${t.decided}` : String(gate.decided), enough === null ? "info" : enough ? "ok" : "bad", enough === null ? null : enough ? "✓" : "✗"));
    const rate = gate.agreement;
    if (!isNum(rate)) out.push(part("agree", "agree", "—", "info"));
    else if (!t || gate.decided < 5) out.push(part("agree", "agree", pct(rate), "info")); // 데이터 부족은 표시 없이
    else {
      const ok = rate >= t.agreement;
      out.push(part("agree", "agree", pct(rate), ok ? "ok" : "bad", ok ? "✓" : "✗"));
    }
  }
  const xc = gate.crosscheck;
  if (xc) out.push(part("crosscheck", "CROSSCHECK", isNum(xc.rate) ? pct(xc.rate) : "—", "info"));
  return out;
}

export function dispatchLineParts(b: DispatchLineIn): LinePart[] {
  const out: LinePart[] = [];
  const items = b.readiness2b?.items;
  if (Array.isArray(items) && items.length) {
    const ready = items.filter((i) => i.status === "ready").length;
    const notReady = items.some((i) => i.status === "not-ready");
    out.push(part("2b", "2b", `${ready}/${items.length}`, ready === items.length ? "ok" : notReady ? "bad" : "info", ready === items.length ? "✓" : notReady ? "✗" : null));
  }
  out.push(...gateParts(b.gate));
  const g3 = b.gate3;
  // STAGE 3 블록을 그리는 조건과 같다: 승인 운용이거나 보낸 FLIGHT PLAN이 있을 때
  if (g3 && isNum(g3.dispatched) && (b.mode === "approval" || g3.dispatched > 0)) {
    const t = g3.target?.dispatched;
    out.push(part("stage3", "S3", isNum(t) ? `${g3.dispatched}/${t}` : String(g3.dispatched), g3.ready ? "ok" : "bad", g3.ready ? "✓" : "✗"));
  }
  return out;
}

// 접힌 줄의 글: `READINESS · 2b 5/8 · gate 12/20 ✗ · agree 92% ✓ · CROSSCHECK 93%`
export const partText = (p: LinePart) => `${p.label} ${p.value}${p.mark ? ` ${p.mark}` : ""}`;
export const lineText = (parts: LinePart[]) => ["READINESS", ...parts.map(partText)].join(" · ");

// ---- 맨 위에 펴 두는 예외 ----

// ATFM: 실제로 걸린 GROUND STOP·GROUND DELAY, 또는 main CI 실패. 이때만 ATFM 스위치와 ATFM OFF가 맨 위에 나온다
export function atfmAlertOf(a: { groundStops?: { enforced?: boolean }[]; mains?: { state?: string }[] } | null | undefined): { active: boolean; stops: number; mainsFailing: number } {
  const stops = (a?.groundStops ?? []).filter((s) => s.enforced).length;
  const mainsFailing = (a?.mains ?? []).filter((m) => m.state === "failure").length;
  return { active: stops + mainsFailing > 0, stops, mainsFailing };
}

// FLIGHT FOLLOWING: 지연·불일치가 있는 FLIGHT만
export function followingExceptions<T extends { issues?: { kind?: string }[] }>(items: T[] | null | undefined): T[] {
  return (items ?? []).filter((f) => (f.issues ?? []).some((i) => i.kind === "delay" || i.kind === "mismatch"));
}
