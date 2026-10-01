import { registrationOf } from "./registration.ts";

// SKILL-CALL READER(ATC-289, docs/readability.md): 대화 기록에서 Skill·sub-agent 호출의 이름과 시각만 뽑고, FLIGHT RECORDER의 qrh.named와 맞춘다.
// 순수 함수만 둔다(입출력은 skill-calls-run.ts). 메시지 본문과 도구 입력은 이름 말고는 남기지 않는다.

export interface Call {
  at: string;
  kind: "skill" | "agent";
  name: string; // Skill은 플러그인 이름공간을 포함한 그대로(`atc-rulebook:qrh-04-go-around`), sub-agent는 subagent_type
}
export interface SessionCalls {
  session: string; // sessionId
  reg: string | null; // 세션 이름(agent-name): TEAM_X, TOWER …
  role: string | null; // 관제 세션 폴더에서 온 기록이면 tower·occ …
  calls: Call[];
  turns: string[]; // 사용자 차례(사람·다른 세션의 메시지)가 시작된 시각. 도구 결과와 시스템이 끼운 메시지는 아니다
  uses?: string[]; // 모든 도구 호출의 시각(이름 없이). 요청했을 때만 담는다(ATC-297)
}
export type ScanState = { reg: string | null; calls: Call[]; turns: string[]; uses?: string[] };

export const emptyScan = (withUses = false): ScanState => ({ reg: null, calls: [], turns: [], ...(withUses ? { uses: [] } : {}) });

// 한 줄을 읽어 ScanState에 더한다. 큰 줄을 JSON으로 풀지 않으려고 낱말로 먼저 거른다.
// st.uses가 있으면(SQUELCH의 opens 표, ATC-297) 도구를 부를 때마다 그 시각 하나만 더한다: 이름도 입력도 읽지 않는다
export function scanLine(line: string, st: ScanState): void {
  if (st.uses && line.includes('"type":"assistant"') && !line.includes('"isSidechain":true')) {
    const n = line.split('"type":"tool_use"').length - 1;
    if (n > 0) {
      let at: string | null = null;
      for (const m of line.matchAll(/"timestamp":"([^"]+)"/g)) at = m[1]!; // 줄 맨 끝쪽의 것이 줄 자신의 시각이다
      if (at) for (let i = 0; i < n; i++) st.uses.push(at);
    }
  }
  if (line.includes('"type":"agent-name"')) {
    try {
      const o = JSON.parse(line) as { type?: string; agentName?: unknown };
      if (o.type === "agent-name" && typeof o.agentName === "string" && o.agentName) st.reg = o.agentName;
    } catch {}
    return;
  }
  if (line.includes('"type":"assistant"')) {
    if (!line.includes('"tool_use"') || !/"name":"(Skill|Agent|Task)"/.test(line)) return;
    let o: { type?: string; timestamp?: string; isSidechain?: boolean; message?: { content?: unknown } };
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    if (o.type !== "assistant" || o.isSidechain === true || !o.timestamp || !Array.isArray(o.message?.content)) return;
    for (const b of o.message.content as { type?: string; name?: string; input?: { skill?: unknown; subagent_type?: unknown } }[]) {
      if (b?.type !== "tool_use") continue;
      if (b.name === "Skill" && typeof b.input?.skill === "string" && b.input.skill) st.calls.push({ at: o.timestamp, kind: "skill", name: b.input.skill });
      else if ((b.name === "Agent" || b.name === "Task") && typeof b.input?.subagent_type === "string" && b.input.subagent_type) st.calls.push({ at: o.timestamp, kind: "agent", name: b.input.subagent_type });
    }
    return;
  }
  if (line.includes('"type":"user"') && !line.includes('"type":"tool_result"')) {
    let o: { type?: string; timestamp?: string; isSidechain?: boolean; isMeta?: boolean };
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    if (o.type === "user" && o.timestamp && o.isSidechain !== true && o.isMeta !== true) st.turns.push(o.timestamp);
  }
}

// 텍스트 전체(시험용). 실제 읽기는 줄 단위로 scanLine을 부른다
export function scanTranscript(text: string): ScanState {
  const st = emptyScan();
  for (const l of text.split("\n")) if (l) scanLine(l, st);
  return st;
}

// ── 하루치 집계 ──
export interface Usage {
  skills: Record<string, number>;
  agents: Record<string, number>;
  bySession: Record<string, { skills: number; agents: number }>; // 키는 세션 이름(TEAM_X, TOWER …), 모르면 역할, 그도 모르면 "unknown"
  sessions: number; // 창 안에 호출이 있었던 세션 수
}
export function usageOf(sessions: readonly SessionCalls[], from: string, to: string): Usage {
  const u: Usage = { skills: {}, agents: {}, bySession: {}, sessions: 0 };
  for (const s of sessions) {
    let any = false;
    for (const c of s.calls) {
      if (c.at < from || c.at >= to) continue;
      any = true;
      const bag = c.kind === "skill" ? u.skills : u.agents;
      bag[c.name] = (bag[c.name] ?? 0) + 1;
      const who = s.reg ? (registrationOf(s.reg) ?? s.reg.toUpperCase()) : (s.role?.toUpperCase() ?? "unknown");
      const r = (u.bySession[who] ??= { skills: 0, agents: 0 });
      if (c.kind === "skill") r.skills++;
      else r.agents++;
    }
    if (any) u.sessions++;
  }
  return u;
}

// ── named → opened ──
export interface Named {
  t: string;
  id: string; // qrh-04-go-around
  session?: string;
  aircraft?: string;
  subject?: string;
}
export type Outcome = "opened" | "opened-other" | "not-opened" | "no-transcript";
export interface Counts {
  named: number;
  opened: number;
  openedOther: number;
  notOpened: number;
  noTranscript: number; // 기록을 찾지 못해 판정할 수 없음. 비율의 분모(named - noTranscript)에서 뺀다
}
// 같은 차례 안에서 본다: 이름 붙인 시각부터 다음 사용자 차례 전까지, 최대 OPEN_WINDOW_MS.
// 서버가 이름을 붙인 글은 곧 그 세션의 사용자 차례로 들어오므로, 시각 t의 GRACE_MS 안에 시작한 차례는 그 글을 나른 차례로 보고 넘긴다
export const OPEN_WINDOW_MS = 10 * 60_000;
export const GRACE_MS = 60_000;

const keyOf = (name: string) => registrationOf(name) ?? name.trim().toUpperCase();
export function sessionsOf(n: Named, sessions: readonly SessionCalls[]): SessionCalls[] {
  const keys = new Set([n.session, n.aircraft].filter((x): x is string => !!x).map(keyOf));
  if (!keys.size) return [];
  return sessions.filter((s) => (n.session && s.session === n.session) || (s.reg && keys.has(keyOf(s.reg))) || (s.role && keys.has(s.role.toUpperCase())));
}
export const baseName = (skill: string) => skill.slice(skill.lastIndexOf(":") + 1);

export function outcomeOf(n: Named, sessions: readonly SessionCalls[]): Outcome {
  const mine = sessionsOf(n, sessions);
  if (!mine.length) return "no-transcript";
  const t = Date.parse(n.t);
  if (!Number.isFinite(t)) return "no-transcript";
  let other = false;
  for (const s of mine) {
    const turn = s.turns.map((x) => Date.parse(x)).filter((x) => x > t + GRACE_MS).sort((a, b) => a - b)[0];
    const end = Math.min(t + OPEN_WINDOW_MS, turn ?? Infinity);
    for (const c of s.calls) {
      if (c.kind !== "skill") continue;
      const at = Date.parse(c.at);
      if (at < t || at >= end) continue;
      const b = baseName(c.name);
      if (b === n.id) return "opened";
      if (b.startsWith("qrh-")) other = true;
    }
  }
  return other ? "opened-other" : "not-opened";
}

export function matchNamed(named: readonly Named[], sessions: readonly SessionCalls[]): Counts {
  const c: Counts = { named: named.length, opened: 0, openedOther: 0, notOpened: 0, noTranscript: 0 };
  for (const n of named) {
    const o = outcomeOf(n, sessions);
    if (o === "opened") c.opened++;
    else if (o === "opened-other") c.openedOther++;
    else if (o === "not-opened") c.notOpened++;
    else c.noTranscript++;
  }
  return c;
}
// 열린 비율 = opened / (named - noTranscript). 분모가 0이면 null
export const openedRate = (c: Counts) => (c.named - c.noTranscript > 0 ? c.opened / (c.named - c.noTranscript) : null);
