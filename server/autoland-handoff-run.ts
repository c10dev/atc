import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type AutolandView, loadAutoland, saveAutoland } from "./autoland.ts";
import { appendRecord as appendAutolandRecord } from "./autoland-record.ts";
import { type HandoffMode, type HandoffRecord, handoffOf, handoffView, landSentTo, observeHandoffs, parseHandoffRecords } from "./autoland-handoff.ts";
import { config } from "./config.ts";
import type { AutolandHandoff } from "./land-by.ts";
import type { PullRequest } from "./model.ts";
import { record } from "./recorder.ts";

// AUTOLAND 넘김(ATC-513)의 파일 입출력. 기록은 추가만 하는 JSONL(autoland-handoff.jsonl)이고 FLIGHT RECORDER(kind "handoff")에 같은 줄이 간다.
// 스위치는 autoland.json의 handoff(없으면 on). 읽기는 늘 실패해도 기본값으로 돈다.

const FILE = () => join(config.stateDir, "autoland-handoff.jsonl");
const TAIL_BYTES = 2_000_000;

export const loadHandoffMode = (): HandoffMode => (loadAutoland().handoff === "off" ? "off" : "on");

// 스냅샷 하나에서 PR마다 넘김 판정을 주는 함수. 스위치는 한 번만 읽는다(PR마다 파일을 읽지 않게)
export function handoffResolver(s: { autoland?: AutolandView | undefined }): (p: Pick<PullRequest, "repo" | "number" | "head" | "landing" | "draft">) => AutolandHandoff | null {
  const on = loadHandoffMode() === "on";
  return (p) => handoffOf(s.autoland, on, p);
}

export function readHandoffRecords(): HandoffRecord[] {
  try {
    const text = readFileSync(FILE(), "utf8");
    return parseHandoffRecords(text.length > TAIL_BYTES ? text.slice(text.indexOf("\n", text.length - TAIL_BYTES) + 1) : text);
  } catch {
    return [];
  }
}

function append(r: HandoffRecord) {
  try {
    mkdirSync(dirname(FILE()), { recursive: true });
    appendFileSync(FILE(), JSON.stringify(r) + "\n");
    record({ kind: "handoff", ...r });
  } catch {
    // 기록이 안 되어도 착륙 판정은 돈다
  }
}

// 설정 창의 블록이 그릴 자료: 세기 둘과 최근 기록
export const handoffData = (nowMs = Date.now()) => handoffView(readHandoffRecords(), nowMs);

// 스위치(SUPERVISOR만: 설정 창 PUT /api/settings의 autolandHandoff)
export function setHandoffMode(mode: HandoffMode) {
  const cfg = loadAutoland();
  const from = loadHandoffMode();
  if (from === mode) return;
  saveAutoland({ ...cfg, handoff: mode });
  appendAutolandRecord({ op: "handoff", mode: cfg.mode, detail: `${from} → ${mode}` });
  record({ t: new Date().toISOString(), kind: "policy", op: "autoland-handoff-mode", by: "SUPERVISOR", from, to: mode });
}

// 한 주기(autoland-run의 cycle): 새로 넘긴 (PR, head)를 mark로, 열린 목록에서 사라진 넘김 PR은 GitHub에서 상태를 읽어 done으로 적는다.
// 상태를 못 읽으면(GitHub off·오류·아직 열림) 다음 주기에 다시 본다. readState는 GitHub 읽기 하나(gh pr view)다
export async function observeCycle(
  s: { pulls: readonly PullRequest[]; airports: readonly { code: string; repo: string }[]; autoland?: AutolandView },
  readState: (slug: string, number: number) => Promise<"merged" | "closed" | "open" | null>,
) {
  const now = new Date().toISOString();
  const seen = observeHandoffs(s, loadHandoffMode() === "on", readHandoffRecords(), now);
  for (const m of seen.marks) append(m);
  for (const g of seen.gone) {
    if (!g.slug) continue;
    const state = await readState(g.slug, g.number).catch(() => null);
    if (state === "merged" || state === "closed") append({ t: new Date().toISOString(), op: "done", pr: g.pr, number: g.number, result: state });
  }
}

// POST /api/clearances: LAND가 AUTOLAND가 넘긴 head의 PR로 나가면(TOWER가 지켜야 하는 규칙이 깨졌다) 센다. 막지는 않는다(0이어야 하는 오작동 세기)
export function noteLandSent(clearance: { id: string; stand?: string | null; flight?: string | null }, s: { pulls: readonly PullRequest[]; autoland?: AutolandView }) {
  const hit = landSentTo(clearance, s, loadHandoffMode() === "on");
  if (hit) append({ t: new Date().toISOString(), op: "land-sent", pr: hit.pr, number: hit.number, head: hit.head, clearance: clearance.id });
}
