import type { AutoRevertLine } from "./auto-revert.ts";

// RED MAIN 줄(ATC-536, docs/autonomy.md C4): AUTO-REVERT가 사람의 머지라서 HOLD한 채 main이 아직 빨가면, 어느 체크가 깨졌고 어느 PR이 막혔고 누가 고칠 수 있는지 SUPERVISOR QUEUE 한 줄(NEEDS YOU)로 이름 붙인다.
// 순수 함수만 둔다(파일·스위치는 red-main-run.ts). 되돌리지도 머지하지도 보내지도 않는다: SUPERVISOR가 읽는 가리킴일 뿐이다. 줄은 head마다 하나이고, main이 초록이 되거나 새 head가 오면 스스로 닫힌다.

export type RedMainSwitch = "off" | "on";
export const RED_MAIN_SWITCHES: readonly RedMainSwitch[] = ["off", "on"];
// 파일에 없거나 모르는 값이면 on(live first). 끄는 것은 SUPERVISOR가 쓴 off뿐이다
export const parseRedMainSwitch = (v: unknown): RedMainSwitch => (v === "off" ? "off" : "on");

export interface RedMainMain {
  airport: string;
  repo: string;
  sha: string | null;
  state: string;
  failing: readonly string[];
}
export interface RedMainPull {
  repo: string;
  number: number;
  blocks: readonly { code: string; checks?: readonly string[] }[];
}

export interface RedMainHold {
  airport: string;
  head: string; // main head 전체 sha
  checks: string[]; // main이 실패한 체크
  foreign: { sha: string; pr?: number }; // 마지막 초록 뒤의 사람 커밋(제일 새 것)
  blocked: number[]; // 같은 체크로 checks-failed인 열린 PR(번호순)
  since: string; // HOLD 줄의 시각
}

export const shortSha = (s: string) => s.slice(0, 7);

// 지금 열려 있어야 하는 줄. main이 빨갛고, 그 head에 사람 커밋 때문에 HOLD한 줄이 있을 때만(그 밖의 HOLD는 K1·K3 같은 다른 이유라 이 줄이 아니다)
export function redMainHoldsOf(x: { lines: readonly AutoRevertLine[]; mains: readonly RedMainMain[]; pulls: readonly RedMainPull[] }): RedMainHold[] {
  const out: RedMainHold[] = [];
  for (const m of x.mains) {
    if (m.state !== "failure" || !m.sha) continue;
    const hold = [...x.lines].reverse().find((l) => l.op === "hold" && l.airport === m.airport && l.head === m.sha && l.foreign);
    if (!hold?.foreign) continue;
    const checks = [...new Set(m.failing)];
    const same = new Set(checks);
    const blocked = x.pulls
      .filter((p) => p.repo === m.repo && p.blocks.some((b) => b.code === "checks-failed" && (b.checks ?? []).some((c) => same.has(c))))
      .map((p) => p.number)
      .sort((a, b) => a - b);
    out.push({ airport: m.airport, head: m.sha, checks, foreign: hold.foreign, blocked, since: hold.at });
  }
  return out;
}

export const redMainKey = (h: Pick<RedMainHold, "airport" | "head">) => `${h.airport}|${h.head}`;

// 줄의 글. 체크 이름·head·사람 커밋·막힌 PR·누가 고치나를 한 줄에
export function redMainText(h: RedMainHold): { title: string; detail: string; need: string } {
  const prs = h.blocked.length ? h.blocked.map((n) => `#${n}`).join(", ") : "없음";
  const who = h.foreign.pr != null ? `PR #${h.foreign.pr}(${shortSha(h.foreign.sha)})을 머지한 사람` : `커밋 ${shortSha(h.foreign.sha)}를 올린 사람`;
  return {
    title: `MAIN RED ${h.airport} ${shortSha(h.head)}`,
    detail: `main ${shortSha(h.head)}이 빨강 — 깨진 체크: ${h.checks.join(", ") || "(이름 모름)"} · 사람의 머지라 AUTO-REVERT는 되돌리지 않고 HOLD · 같은 체크로 막힌 PR ${h.blocked.length}개: ${prs}`,
    need: `${who}(또는 SUPERVISOR)가 고친다: 되돌리거나 고치는 PR을 올리면 막힌 PR이 풀린다. atc는 아무것도 보내지 않는다`,
  };
}

// ── 에피소드 기록(red-main-episodes.jsonl, 추가만): 줄이 올라간 때(raised)와 내려간 때(closed) ──
// end: cleared는 스스로 닫힘(main이 초록이 됐거나 새 head로 바뀜), switch는 SUPERVISOR가 끔
export type RedMainEnd = "cleared" | "switch";
export interface RedMainLine {
  at: string;
  op: "raised" | "closed";
  airport: string;
  head: string;
  checks?: string[];
  pr?: number; // 사람 커밋의 PR
  blocked?: number[];
  end?: RedMainEnd;
}

export function openEpisodesOf(lines: readonly RedMainLine[]): Map<string, RedMainLine> {
  const open = new Map<string, RedMainLine>();
  for (const l of lines) {
    const k = redMainKey(l);
    if (l.op === "raised") open.set(k, l);
    else open.delete(k);
  }
  return open;
}

// 지금 있어야 하는 줄(active, 스위치가 off면 빈 목록)에 맞춰 덧붙일 기록. head마다 한 번만 올린다: 이미 올렸던(닫힌 것 포함) head는 다시 올리지 않는다
export function syncEpisodes(lines: readonly RedMainLine[], active: readonly RedMainHold[], off: boolean, now: string): RedMainLine[] {
  const open = openEpisodesOf(lines);
  const seen = new Set(lines.filter((l) => l.op === "raised").map(redMainKey));
  const want = new Set(active.map(redMainKey));
  const out: RedMainLine[] = [];
  for (const [k, l] of open) if (!want.has(k)) out.push({ at: now, op: "closed", airport: l.airport, head: l.head, end: off ? "switch" : "cleared" });
  for (const h of active) {
    const k = redMainKey(h);
    if (open.has(k) || seen.has(k)) continue;
    out.push({ at: now, op: "raised", airport: h.airport, head: h.head, checks: h.checks, ...(h.foreign.pr != null ? { pr: h.foreign.pr } : {}), blocked: h.blocked });
  }
  return out;
}

// 카운터: 올린 수와 스스로 닫힌 수(스위치로 끈 것은 따로)
export function redMainCounterOf(lines: readonly RedMainLine[], now: number, days: number) {
  const since = now - days * 86_400_000;
  const inWin = lines.filter((l) => Date.parse(l.at) >= since);
  return {
    raised: inWin.filter((l) => l.op === "raised").length,
    closedBySelf: inWin.filter((l) => l.op === "closed" && l.end === "cleared").length,
    closedBySwitch: inWin.filter((l) => l.op === "closed" && l.end === "switch").length,
    open: openEpisodesOf(lines).size,
    days,
  };
}
