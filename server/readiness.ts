import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry } from "./airports.ts";
import { config } from "./config.ts";
import { assignableAirportCodes, type DispatchConfig, loadDispatchConfig } from "./dispatch.ts";

// "2b 켜기 점검표": 2b(approval)를 켜기 전에 볼 것. 표시만 하고 모드는 바꾸지 않는다(SUPERVISOR가 바꾼다).
// 계산은 순수 함수(readiness2bOf, vocadoReadbackOf, airportReadbackOf, sendGuardOf), 파일 읽기는 readinessFiles.
// 코드 사실 점검은 proposals.ts selfCheck2b(RECALL·STAND 없는 FLIGHT)와 crew-change.ts selfCheckCrewChange.
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

// dispatch.json 기본값의 AIRPORT 코드(server/dispatch.ts DEFAULT_DISPATCH_CONFIG). vocado는 늘 vocadoClaudeMdPath()로, atc 자신은 늘 이 저장소 루트로 읽는다 — 등록부(airports.json)에 없어도 된다
const VOCADO_AIRPORT_CODE = "VCDO";
const ATC_TEAM_KEY = "ATC"; // atc 작업은 Linear atc 팀(ATC)에 둔다(루트 CLAUDE.md "계획과 아이디어")

// 저장소 CLAUDE.md에 더할 문장. vocado의 `[ATC C-xxxx]` 줄과 같은 말투. atc 자신의 루트 CLAUDE.md "교신" 절도 이 문장을 쓴다.
// UNABLE·STANDBY·ROGER는 ATC-122(server/response.ts)
export const VOCADO_READBACK_SUGGESTION =
  "- atc OCC(운항관제 세션)에서 `[DISPATCH D-xxxx]`로 시작하는 FLIGHT PLAN을 받으면 리더가 그 메시지에 끝줄이 주는 답 한 줄 `READBACK D-xxxx @xxxxxx`로 답하고(`@xxxxxx`는 FLIGHT PLAN에 적힌 work-order 해시, 빠지면 거절된다. 해시가 없는 옛 FLIGHT PLAN은 `READBACK D-xxxx`), 맡지 못하면 `UNABLE D-xxxx — 사유`, 시간이 필요하면 `STANDBY D-xxxx`로 답한다. " +
  "`[DISPATCH D-xxxx] RECALL`을 받으면 작업을 멈추고 `READBACK D-xxxx RECALL`로 답한다. " +
  "`[OCC CC-xxxx]`로 시작하는 CREW CHANGE를 받으면 `READBACK CC-xxxx`로 답하고 그대로 팀원을 바꾼다(못 하면 `UNABLE CC-xxxx — 사유`). " +
  "`[ATC C-xxxx]` CLEARANCE는 끝줄이 청하는 답으로 답한다(지시는 `READBACK`·`UNABLE`·`STANDBY`, 알림은 `ROGER C-xxxx`). " +
  "STAND(worktree) 없이 하는 SURVEY·CHECK FLIGHT를 마치면 OCC에 결과 링크나 한 줄로 알린다.";

// AIRPORT 저장소의 CLAUDE.md가 OCC 메시지를 다루나: 한 줄에 `[DISPATCH D-`와 `READBACK D-`(FLIGHT PLAN),
// 한 줄에 `[OCC CC-`와 `READBACK CC-`(CREW CHANGE)가 모두 있어야 ready. vocado와 그 밖의 AIRPORT가 공유하는 판정
function readbackRuleOf(text: string, path: string): { status: "ready" | "not-ready"; detail: string; suggestion?: string } {
  const lines = text.split("\n");
  const find = (a: RegExp, b: RegExp) => lines.findIndex((l) => a.test(l) && b.test(l));
  const plan = find(/\[DISPATCH D-/, /READBACK D-/);
  const cc = find(/\[OCC CC-/, /READBACK CC-/);
  if (plan >= 0 && cc >= 0)
    return {
      status: "ready",
      detail: `${path}:${plan + 1} — [DISPATCH D-xxxx] FLIGHT PLAN에 READBACK D-xxxx, ${path}:${cc + 1} — [OCC CC-xxxx] CREW CHANGE에 READBACK CC-xxxx로 답하는 규칙 있음`,
    };
  const atc = find(/\[ATC C-/, /READBACK C-/);
  const where =
    plan >= 0
      ? `${path}:${plan + 1}은 [DISPATCH D-xxxx]만 다루고 [OCC CC-xxxx] → READBACK CC-xxxx가 없다`
      : atc >= 0
        ? `${path}:${atc + 1}은 [ATC C-xxxx] → READBACK C-xxxx만 다룬다`
        : `${path}에 READBACK 규칙이 없다`;
  const missing = [plan < 0 && "FLIGHT PLAN", cc < 0 && "CREW CHANGE"].filter(Boolean).join("·");
  return {
    status: "not-ready",
    detail: `${where}. CAPTAIN이 ${missing}에 답할 규칙이 없음. 추가할 문장: ${VOCADO_READBACK_SUGGESTION}`,
    suggestion: VOCADO_READBACK_SUGGESTION,
  };
}

// vocado CLAUDE.md는 읽기만 한다(SUPERVISOR만 고친다). 파일을 못 읽으면 ATC_VOCADO_CLAUDE_MD로 경로를 지정하라고 안내한다
export function vocadoReadbackOf(text: string | null, path: string): ReadinessItem {
  const base = { id: "vocado-readback", label: "vocado READBACK 규칙" };
  if (text === null) return { ...base, status: "check", detail: `${path}을 읽지 못함 — 직접 확인(ATC_VOCADO_CLAUDE_MD로 경로 지정)` };
  return { ...base, ...readbackRuleOf(text, path) };
}

// vocado 밖의 AIRPORT(atc 자신 포함) 한 곳의 READBACK 규칙. 저장소를 등록부에서 못 찾으면(path === null) check
export function airportReadbackOf(text: string | null, path: string | null, code: string): ReadinessItem {
  const base = { id: `readback-${code.toLowerCase()}`, label: `${code} READBACK 규칙` };
  if (path === null) return { ...base, status: "check", detail: `${code} AIRPORT의 저장소를 등록부에서 찾지 못함 — RADAR에서 개설했는지 확인` };
  if (text === null) return { ...base, status: "check", detail: `${path}을 읽지 못함 — 직접 확인` };
  return { ...base, ...readbackRuleOf(text, path) };
}

// send-guard: 서버는 테스트를 돌리지 않는다. 파일이 있고 FLIGHT PLAN·RECALL 비교가 들어 있는지만 보고 "check"로 둔다
export function sendGuardOf(source: string | null, testExists: boolean): ReadinessItem {
  const base = { id: "send-guard", label: "send-guard (FLIGHT PLAN·RECALL·CREW CHANGE)", link: SEND_GUARD_TEST_LINK };
  if (source === null) return { ...base, status: "not-ready", detail: "occ/send-guard.mjs가 없음 — OCC의 SendMessage를 지킬 hook이 없다" };
  const need: [string, RegExp][] = [
    ["checkSend export", /export\s+async\s+function\s+checkSend\b/],
    ["approval 모드 확인", /mode\s*!==\s*"approval"/],
    ["FLIGHT PLAN 문구 비교(proposal.message)", /proposal\.message/],
    ["RECALL 문구 비교(proposal.recallMessage)", /proposal\.recallMessage/],
    ["받는 사람 확인(aircraftName)", /aircraftName/],
    ["CREW CHANGE 문구 비교(change.message)", /change\.message/],
    ["CREW CHANGE 받는 사람 확인(change.registration)", /change\.registration/],
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
  crewChangeMissing: string[]; // crew-change.ts selfCheckCrewChange
  sendGuard: ReadinessItem;
  readback: ReadinessItem[]; // AIRPORT마다 하나(vocadoReadbackOf·airportReadbackOf), readinessFiles가 candidateTeams로 만든다
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
      ...f.readback,
      built(
        "stand-free",
        "STAND 없는 FLIGHT(SURVEY·CHECK)",
        f.standFreeMissing,
        "READBACK에 DEPARTED(stand 없음) → ARRIVED 보고(dispatch arrived)까지 AIRCRAFT·FLIGHT를 잡아 둠, 만료 없음",
      ),
      built(
        "crew-change",
        "CREW CHANGE 발부",
        f.crewChangeMissing,
        "SUPERVISOR 승인(approval 모드만) → crew-change send(sent) → READBACK CC-xxxx(acknowledged) 전이, [OCC CC-xxxx] 문구, 10분 overdue, approved는 대신하고 sent는 READBACK까지 기다림, approve·send·readback API, atcctl crew-change send·readback이 있음",
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

// AIRPORT마다 READBACK 규칙 한 줄: vocado는 늘 vocadoClaudeMdPath(), atc 자신은 늘 이 저장소 루트, 그 밖은 등록부(airports.json)의 path에서 읽는다
function readbackRowsOf(cfg: Pick<DispatchConfig, "candidateTeams" | "teamAirports" | "projectAirports">): ReadinessItem[] {
  const vocadoPath = vocadoClaudeMdPath();
  const ownCode = cfg.teamAirports[ATC_TEAM_KEY] ?? null;
  const { entries } = loadRegistry();
  return [...assignableAirportCodes(cfg)].sort().map((code) => {
    if (code === VOCADO_AIRPORT_CODE) return vocadoReadbackOf(readOrNull(vocadoPath), vocadoPath);
    if (code === ownCode) {
      const path = join(ROOT, "CLAUDE.md");
      return airportReadbackOf(readOrNull(path), path, code);
    }
    const entry = entries.find((e) => e.code === code && !e.closed);
    const path = entry ? join(entry.path, "CLAUDE.md") : null;
    return airportReadbackOf(path && readOrNull(path), path, code);
  });
}

export function readinessFiles(cfg: Pick<DispatchConfig, "candidateTeams" | "teamAirports" | "projectAirports"> = loadDispatchConfig()) {
  return {
    sendGuard: sendGuardOf(readOrNull(join(ROOT, "occ", "send-guard.mjs")), existsSync(join(ROOT, "occ", "send-guard.test.mjs"))),
    readback: readbackRowsOf(cfg),
    atcctl: readOrNull(join(ROOT, "controller", "atcctl.mjs")),
  };
}
