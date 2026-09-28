import { resolve, sep } from "node:path";

// HUMAN CHECK(ATC-37). 사람이 꼭 봐야 하는 PR만 atc에 모은다: PR 본문 `## UI change` 블록의 class가 CHOICE·ACCOUNT·DEVICE인 PR.
// 사람의 결과는 head SHA에 묶이고(`Human check: done <date> <sha> <note>`), main 병합만 한 head는 이어받는다(ATC-31).
// 이 파일은 순수 계산. GitHub 읽기·쓰기와 API는 human-check-run.ts

export const HUMAN_CLASSES = ["CHOICE", "ACCOUNT", "DEVICE"] as const;
export type HumanClass = (typeof HUMAN_CLASSES)[number];

// `Human check:` 줄의 값
export interface HumanCheckLine {
  state: "not-needed" | "pending" | "done" | "failed" | "unfilled";
  date: string | null;
  sha: string | null; // 적힌 SHA(짧을 수 있다)
  note: string | null;
}

// `## UI change` 블록에서 atc가 읽는 칸
export interface UiChange {
  impact: "none" | "changes" | "unfilled";
  classes: HumanClass[];
  classUnfilled: boolean; // class 줄이 없거나 템플릿 그대로
  evidence: string | null; // Evidence pack 값(링크 등)
  evidenceComment: { slug: string; number: number; id: number } | null; // Evidence pack이 가리키는 PR 댓글
  preview: string | null; // ACCOUNT·DEVICE: 현재 head의 Preview URL
  steps: string | null; // ACCOUNT·DEVICE: 사람이 할 1~3 단계
  check: HumanCheckLine;
  checkLines: number; // 블록 안 `Human check:` 줄 수(atc는 딱 하나일 때만 고쳐 쓴다)
}

const FIELD = /^\s*[-*]\s+([^:]+?):(.*)$/;
const HEADING = /^##\s+UI change\s*$/i;
const labelOf = (raw: string) => raw.replace(/\([^)]*\)/g, "").trim().toLowerCase();
const unticked = (v: string) => v.replace(/`/g, "").trim();
const empty = (v: string) => !v || /^(n\/?a|none|-|—)\b/i.test(v);

// `## UI change` 블록(다음 `## ` 머리까지)의 줄 범위. 없으면 null
function blockRange(lines: string[]): [number, number] | null {
  const start = lines.findIndex((l) => HEADING.test(l.trim()));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++)
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  return [start + 1, end];
}

export function parseCheckLine(value: string): HumanCheckLine {
  const v = unticked(value).replace(/\s+/g, " ");
  const m = /^(done|failed)\s+(\d{4}-\d{2}-\d{2})\s+([0-9a-f]{7,40})\b\s*(.*)$/i.exec(v);
  if (m) return { state: m[1].toLowerCase() as "done" | "failed", date: m[2], sha: m[3].toLowerCase(), note: m[4].trim() || null };
  if (/^not needed$/i.test(v)) return { state: "not-needed", date: null, sha: null, note: null };
  if (/^pending$/i.test(v)) return { state: "pending", date: null, sha: null, note: null };
  return { state: "unfilled", date: null, sha: null, note: null };
}

function parseClasses(value: string): { classes: HumanClass[]; unfilled: boolean } {
  const v = unticked(value);
  const found = [...new Set((v.match(/\b(choice|account|device)\b/gi) ?? []).map((c) => c.toUpperCase() as HumanClass))];
  const none = /\bnone\b/i.test(v);
  // 템플릿 그대로(설명 괄호, 또는 선택지 전부)면 채우지 않은 것
  if (/\(/.test(v) || (found.length === HUMAN_CLASSES.length && none)) return { classes: [], unfilled: true };
  if (found.length) return { classes: HUMAN_CLASSES.filter((c) => found.includes(c)), unfilled: false };
  return { classes: [], unfilled: !none };
}

function parseImpact(value: string): UiChange["impact"] {
  const v = unticked(value).toLowerCase();
  if (v.includes("/")) return "unfilled";
  if (/^none\b/.test(v)) return "none";
  if (/change/.test(v)) return "changes";
  return "unfilled";
}

// PR 본문의 `## UI change` 블록. 블록이 없으면 null(옛 본문)
export function uiChangeOf(body: string | null | undefined): UiChange | null {
  const lines = (body ?? "").replace(/\r\n/g, "\n").split("\n");
  const range = blockRange(lines);
  if (!range) return null;
  const fields = new Map<string, string>();
  let checkLines = 0;
  let current: string | null = null;
  for (let i = range[0]; i < range[1]; i++) {
    const line = lines[i];
    const m = FIELD.exec(line);
    // 들여쓴 줄은 앞 칸에 이어 붙인다(Human steps의 1~3 단계)
    if (m && !/^\s{2,}/.test(line)) {
      current = labelOf(m[1]);
      if (current === "human check") checkLines++;
      if (!fields.has(current)) fields.set(current, m[2].trim());
    } else if (current && line.trim()) fields.set(current, `${fields.get(current)}\n${line.trim()}`.trim());
  }
  const get = (k: string) => fields.get(k) ?? "";
  const { classes, unfilled } = fields.has("human check class") ? parseClasses(get("human check class")) : { classes: [], unfilled: true };
  const evidence = get("evidence pack");
  const link = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)#issuecomment-(\d+)/.exec(evidence);
  const previewUrl = /https?:\/\/[^\s)`>]+/.exec(get("preview"))?.[0] ?? null;
  const steps = get("human steps");
  return {
    impact: parseImpact(get("ui impact")),
    classes,
    classUnfilled: unfilled,
    evidence: evidence && !empty(unticked(evidence)) ? evidence : null,
    evidenceComment: link ? { slug: link[1], number: Number(link[2]), id: Number(link[3]) } : null,
    preview: previewUrl,
    steps: steps && !empty(unticked(steps)) && !/^1[–-]3 steps\b/i.test(unticked(steps)) ? steps : null,
    check: parseCheckLine(get("human check")),
    checkLines,
  };
}

// 이 head에서 사람 확인이 어떤가
export interface HumanCheckStatus {
  required: boolean; // CHOICE·ACCOUNT·DEVICE 중 하나라도
  classes: HumanClass[];
  // done·failed: 이 head(또는 main 병합만 한 이전 커밋)에 기록됨. stale: 옛 head에 기록됨. 나머지는 줄 그대로
  state: "done" | "failed" | "stale" | "pending" | "not-needed" | "unfilled";
  sha: string | null; // 줄에 적힌 SHA
  carriedFrom: string | null; // 이어받았으면 그 커밋(전체 SHA)
}

// carry: main 병합만 한 head의 이전 커밋들(ATC-31 carryFrom, 최근 것 먼저)
export function humanCheckStatusOf(ui: UiChange | null, head: string, carry: readonly string[] = []): HumanCheckStatus | null {
  if (!ui) return null;
  const required = ui.impact !== "none" && ui.classes.length > 0;
  const { check } = ui;
  const base = { required, classes: ui.classes, sha: check.sha, carriedFrom: null };
  if ((check.state === "done" || check.state === "failed") && check.sha) {
    if (head.toLowerCase().startsWith(check.sha)) return { ...base, state: check.state };
    const from = carry.find((c) => c.toLowerCase().startsWith(check.sha!));
    if (from) return { ...base, state: check.state, carriedFrom: from };
    return { ...base, state: "stale" };
  }
  return { ...base, state: check.state === "done" || check.state === "failed" ? "unfilled" : check.state };
}

// HUMAN CHECK 대기열에 드는가: class가 있고 이 head에 done이 아니다
export const waitsOnHuman = (s: HumanCheckStatus | null | undefined) => Boolean(s?.required && s.state !== "done");

const STATE_TEXT: Record<HumanCheckStatus["state"], string> = {
  done: "done",
  failed: "failed",
  stale: "옛 head에 기록됨",
  pending: "pending",
  "not-needed": "not needed로 적힘",
  unfilled: "채우지 않음",
};
export const humanStateText = (s: HumanCheckStatus) => STATE_TEXT[s.state];

// AUTOLAND merge가 머지하지 않는 까닭(ATC-34의 human-preview 제외를 바꾼다). null이면 막지 않는다.
// 블록이 없으면 사람 확인이 필요한지 모르므로 머지하지 않는다(옛 본문의 게이트는 읽지 않는다)
export function humanCheckExclusionOf(ui: UiChange | null, status: HumanCheckStatus | null): string | null {
  if (!ui) return "UI change 블록 없음 — HUMAN CHECK 필요 여부를 모름";
  if (ui.impact === "none") return null;
  if (ui.classUnfilled) return "UI change class를 채우지 않음";
  if (status && waitsOnHuman(status)) return `HUMAN CHECK ${status.classes.join("·")} — ${humanStateText(status)}`;
  return null;
}

// ── 기록(SUPERVISOR의 PASS·FAIL) ──
export class HumanCheckError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// 메모: 한 줄, 백틱 없이, 200자까지
export const cleanNote = (note: unknown) =>
  (typeof note === "string" ? note : "")
    .replace(/`/g, "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

// `Human check:` 줄에 쓸 값
export function checkValueOf(result: "pass" | "fail", date: string, head: string, note: string): string {
  return `\`${result === "pass" ? "done" : "failed"} ${date} ${head.slice(0, 7)} ${note}\``;
}

// 본문의 `## UI change` 블록 안 `Human check:` 줄 하나만 바꾼 새 본문. 블록이 없거나 줄이 하나가 아니면 거절
export function setHumanCheckLine(body: string, value: string): string {
  const nl = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  const range = blockRange(lines);
  if (!range) throw new HumanCheckError("PR 본문에 ## UI change 블록이 없음", 409);
  const at: number[] = [];
  for (let i = range[0]; i < range[1]; i++) {
    const m = FIELD.exec(lines[i]);
    if (m && !/^\s{2,}/.test(lines[i]) && labelOf(m[1]) === "human check") at.push(i);
  }
  if (at.length !== 1) throw new HumanCheckError(`UI change 블록의 Human check 줄이 ${at.length}개 — 하나일 때만 고쳐 쓴다`, 409);
  const line = lines[at[0]];
  lines[at[0]] = `${line.slice(0, line.indexOf(":") + 1)} ${value}`;
  return lines.join(nl);
}

// PASS·FAIL을 받을 수 있는지(순수). 화면이 본 head와 지금 head가 같아야 한다
export function checkRequestOf(input: { result?: unknown; note?: unknown; head?: unknown }, pr: { head: string; body: string | null; draft: boolean }): { result: "pass" | "fail"; note: string; ui: UiChange } {
  if (input.result !== "pass" && input.result !== "fail") throw new HumanCheckError("result는 pass | fail", 400);
  if (typeof input.head !== "string" || !/^[0-9a-f]{7,40}$/i.test(input.head)) throw new HumanCheckError("head(SHA)가 필요함", 400);
  if (!pr.head.toLowerCase().startsWith(input.head.toLowerCase())) throw new HumanCheckError(`head가 바뀜(${pr.head.slice(0, 7)}) — 새 head를 보고 다시 기록`, 409);
  const ui = uiChangeOf(pr.body);
  if (!ui) throw new HumanCheckError("PR 본문에 ## UI change 블록이 없음", 409);
  const status = humanCheckStatusOf(ui, pr.head);
  if (!status?.required) throw new HumanCheckError("CHOICE·ACCOUNT·DEVICE class가 아님 — 사람 확인 대상이 아니다", 409);
  if (ui.checkLines !== 1) throw new HumanCheckError(`UI change 블록의 Human check 줄이 ${ui.checkLines}개 — 하나일 때만 고쳐 쓴다`, 409);
  const note = cleanNote(input.note);
  if (input.result === "fail" && !note) throw new HumanCheckError("FAIL은 무엇이 틀렸는지 메모가 필요함", 400);
  return { result: input.result, note: note || "checked in atc", ui };
}

// PR 댓글 하나
export function commentOf(result: "pass" | "fail", head: string, classes: readonly HumanClass[], note: string, date: string): string {
  return [
    `**HUMAN CHECK: ${result === "pass" ? "PASS" : "FAIL"}** · head \`${head.slice(0, 7)}\` · ${classes.join(", ")} · ${date}`,
    "",
    `> ${note}`,
    "",
    "Recorded by the SUPERVISOR in atc. It holds for this head and carries across main-only merges; a later change to the PR needs a new check.",
  ].join("\n");
}

// ── 증거 ──
// 댓글 HTML(GitHub body_html)의 이미지 주소. https만, 12개까지
export function imagesOf(html: string | null | undefined, max = 12): string[] {
  const out: string[] = [];
  for (const m of (html ?? "").matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/gi)) {
    const src = m[1].replace(/&amp;/g, "&");
    if (/^https:\/\//.test(src) && !out.includes(src)) out.push(src);
    if (out.length >= max) break;
  }
  return out;
}

// RUN-UP report.json(ATC-41)에서 줄에 보일 것
export interface RunupReport {
  schema?: string;
  head?: { sha?: string };
  summary?: { screens?: number; changedScreens?: number; unexpectedScreens?: number; cuts?: number; changedCuts?: number };
  warnings?: { type?: string; path?: string }[];
  cuts?: { path?: string; state?: string; kind?: string; browser?: string; width?: number; colorScheme?: string; status?: string; images?: { after?: string } }[];
}
export interface RunupView {
  run: string; // .runup 아래 폴더 이름
  screens: number;
  changedScreens: number;
  cuts: number;
  changedCuts: number;
  unexpected: string[];
  thumbs: { image: string; label: string }[]; // 보고서 폴더 기준 상대 경로
}
export function runupViewOf(run: string, r: RunupReport, max = 6): RunupView {
  const changed = (r.cuts ?? []).filter((c) => c.status === "changed" && c.images?.after);
  return {
    run,
    screens: r.summary?.screens ?? 0,
    changedScreens: r.summary?.changedScreens ?? 0,
    cuts: r.summary?.cuts ?? 0,
    changedCuts: r.summary?.changedCuts ?? 0,
    unexpected: (r.warnings ?? []).filter((w) => w.type === "unexpected-change" && w.path).map((w) => w.path!),
    thumbs: changed.slice(0, max).map((c) => ({ image: c.images!.after!, label: [c.path, c.state, c.width && `${c.width}px`, c.colorScheme, c.browser].filter(Boolean).join(" · ") })),
  };
}
// 이 head의 RUN-UP 보고서: 폴더 이름이 `-<head 7자>`로 끝나고 report.json의 head.sha가 head인 것 중 가장 새 것
export function pickRunup<T extends { run: string; mtime: number; report: RunupReport }>(found: readonly T[], head: string): T | null {
  const mine = found.filter((f) => f.run.endsWith(`-${head.slice(0, 7)}`) && f.report.head?.sha === head);
  return mine.reduce<T | null>((a, b) => (!a || b.mtime > a.mtime ? b : a), null);
}
// root 안의 파일만(.. 로 빠져나가지 않게). 밖이면 null
export function insideDir(root: string, rel: string): string | null {
  const base = resolve(root);
  const p = resolve(base, rel);
  return p.startsWith(base + sep) ? p : null;
}
