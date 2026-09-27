import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.ts";

// "2b 켜기 점검표": 2b(approval)를 켜기 전에 볼 것. 표시만 하고 모드는 바꾸지 않는다(SUPERVISOR가 바꾼다).
// 계산은 순수 함수(readiness2bOf, vocadoReadbackOf, sendGuardOf), 파일 읽기는 readinessFiles.
// 설계: docs/dispatch.md "Turning on 2b".

export interface ReadinessItem {
  id: string;
  label: string;
  status: "ready" | "not-ready" | "check";
  detail: string;
  link?: string;
  suggestion?: string; // 붙여 넣을 문장(vocado READBACK 규칙)
}

const REPO = "https://github.com/chaehy5665/atc/blob/main/";
export const KNOWN_GAPS_LINK = `${REPO}docs/dispatch.md#known-gaps-before-turning-on-2b`;
export const SEND_GUARD_TEST_LINK = `${REPO}occ/send-guard.test.mjs`;

// vocado CLAUDE.md에 더할 문장. 그 파일의 `[ATC C-xxxx]` 줄과 같은 말투
export const VOCADO_READBACK_SUGGESTION =
  "- atc OCC(운항관제 세션)에서 `[DISPATCH D-xxxx]`로 시작하는 FLIGHT PLAN을 받으면 리더가 그 메시지에 `READBACK D-xxxx`로 답하고, 맡지 못하면 READBACK 대신 이유를 답한다. " +
  "`[DISPATCH D-xxxx] RECALL`을 받으면 작업을 멈추고 `READBACK D-xxxx RECALL`로 답한다. " +
  "STAND(worktree) 없이 하는 SURVEY·CHECK FLIGHT를 마치면 OCC에 결과 링크나 한 줄로 알린다.";

// vocado READBACK 규칙이 DISPATCH FLIGHT PLAN을 다루나: 한 줄에 `[DISPATCH D-`와 `READBACK D-`가 함께 있어야 ready
export function vocadoReadbackOf(text: string | null, path: string): ReadinessItem {
  const base = { id: "vocado-readback", label: "vocado READBACK 규칙" };
  if (text === null) return { ...base, status: "check", detail: `${path}을 읽지 못함 — 직접 확인(ATC_VOCADO_CLAUDE_MD로 경로 지정)` };
  const lines = text.split("\n");
  const hit = lines.findIndex((l) => /\[DISPATCH D-/.test(l) && /READBACK D-/.test(l));
  if (hit >= 0) return { ...base, status: "ready", detail: `${path}:${hit + 1} — [DISPATCH D-xxxx] FLIGHT PLAN에 READBACK D-xxxx로 답하는 규칙 있음` };
  const atc = lines.findIndex((l) => /\[ATC C-/.test(l) && /READBACK C-/.test(l));
  const where = atc >= 0 ? `${path}:${atc + 1}은 [ATC C-xxxx] → READBACK C-xxxx만 다룬다` : `${path}에 READBACK 규칙이 없다`;
  return {
    ...base,
    status: "not-ready",
    detail: `${where}. CAPTAIN이 FLIGHT PLAN에 답할 규칙이 없음. 추가할 문장: ${VOCADO_READBACK_SUGGESTION}`,
    suggestion: VOCADO_READBACK_SUGGESTION,
  };
}

// send-guard: 서버는 테스트를 돌리지 않는다. 파일이 있고 FLIGHT PLAN·RECALL 비교가 들어 있는지만 보고 "check"로 둔다
export function sendGuardOf(source: string | null, testExists: boolean): ReadinessItem {
  const base = { id: "send-guard", label: "send-guard (FLIGHT PLAN·RECALL)", link: SEND_GUARD_TEST_LINK };
  if (source === null) return { ...base, status: "not-ready", detail: "occ/send-guard.mjs가 없음 — OCC의 SendMessage를 지킬 hook이 없다" };
  const need: [string, RegExp][] = [
    ["checkSend export", /export\s+async\s+function\s+checkSend\b/],
    ["approval 모드 확인", /mode\s*!==\s*"approval"/],
    ["FLIGHT PLAN 문구 비교(proposal.message)", /proposal\.message/],
    ["RECALL 문구 비교(proposal.recallMessage)", /proposal\.recallMessage/],
    ["받는 사람 확인(aircraftName)", /aircraftName/],
    ["fail-closed(exit 2)", /process\.exit\(2\)/],
  ];
  const missing = need.filter(([, re]) => !re.test(source)).map(([name]) => name);
  const sha = createHash("sha256").update(source).digest("hex").slice(0, 8);
  if (missing.length) return { ...base, status: "not-ready", detail: `occ/send-guard.mjs(sha ${sha})에 없음: ${missing.join(", ")}` };
  return {
    ...base,
    status: "check",
    detail:
      `occ/send-guard.mjs(sha ${sha})에 ${need.map(([n]) => n).join(", ")}가 있음. ` +
      `동작은 서버가 확인하지 않는다 — \`node --test occ/send-guard.test.mjs\`${testExists ? "" : "(테스트 파일 없음!)"}로 확인`,
  };
}

export interface ReadinessInput {
  gate: { decided: number; agreement: number | null; ready: boolean; target: { decided: number; agreement: number } };
  // 코드 사실 점검(proposals.ts selfCheck2b). 빠진 것 목록, 비어 있으면 갖춰짐
  recallMissing: string[];
  standFreeMissing: string[];
  sendGuard: ReadinessItem;
  vocado: ReadinessItem;
}

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

export function readiness2bOf(f: ReadinessInput): { items: ReadinessItem[] } {
  const g = f.gate;
  const built = (id: string, label: string, missing: string[], what: string): ReadinessItem =>
    missing.length
      ? { id, label, status: "not-ready", detail: `코드에서 확인 안 됨: ${missing.join(", ")}` }
      : { id, label, status: "ready", detail: what };
  return {
    items: [
      {
        id: "gate",
        label: "2a 게이트(그림자 판정)",
        status: g.ready ? "ready" : "not-ready",
        detail: `판정 ${g.decided}/${g.target.decided}건 · 일치 ${pct(g.agreement)} (기준 ${Math.round(g.target.agreement * 100)}%)`,
      },
      built("recall", "RECALL", f.recallMissing, "recall → recalling → recalled 전이, RECALL 문구, recall·recall-send·recalled API가 있음"),
      f.sendGuard,
      f.vocado,
      built(
        "stand-free",
        "STAND 없는 FLIGHT(SURVEY·CHECK)",
        f.standFreeMissing,
        "READBACK에 DEPARTED(stand 없음) → ARRIVED 보고(dispatch arrived)까지 AIRCRAFT·FLIGHT를 잡아 둠, 만료 없음",
      ),
      {
        id: "known-gaps",
        label: "알려진 빈틈",
        status: "check",
        detail: "켜기 전에 docs/dispatch.md \"Known gaps before turning on 2b\"를 읽고 감수할지 정한다",
        link: KNOWN_GAPS_LINK,
      },
    ],
  };
}

// ── 파일 ──

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const readOrNull = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

// vocado CLAUDE.md는 읽기만 한다. 경로는 ATC_VOCADO_CLAUDE_MD, 없으면 projectsDir/vocado_nextjs/CLAUDE.md
export const vocadoClaudeMdPath = () => process.env.ATC_VOCADO_CLAUDE_MD || join(config.projectsDir, "vocado_nextjs", "CLAUDE.md");

export function readinessFiles() {
  const vocadoPath = vocadoClaudeMdPath();
  return {
    sendGuard: sendGuardOf(readOrNull(join(ROOT, "occ", "send-guard.mjs")), existsSync(join(ROOT, "occ", "send-guard.test.mjs"))),
    vocado: vocadoReadbackOf(readOrNull(vocadoPath), vocadoPath),
    atcctl: readOrNull(join(ROOT, "controller", "atcctl.mjs")),
  };
}
