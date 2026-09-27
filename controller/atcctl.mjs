#!/usr/bin/env node
// TOWER·OCC 세션이 쓰는 atc CLI. atc 서버(기본 http://127.0.0.1:7700)에만 말한다. 의존성 없음.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.ATC_URL || "http://127.0.0.1:7700";
const STATE = process.env.ATC_STATE_DIR || join(homedir(), ".local/state/atc");

// 관제 세션의 운영 규정(CLAUDE.md, /tick). 오래 도는 세션이 바뀐 규정을 모른 채 돌지 않게 해시로 비교한다.
const MANUAL = ["CLAUDE.md", ".claude/skills/tick/SKILL.md"];
function manualHash(dir) {
  const h = createHash("sha256");
  for (const f of MANUAL) {
    h.update(`${f}\0`);
    try {
      h.update(readFileSync(join(dir, f)));
    } catch {
      h.update("(없음)");
    }
  }
  return h.digest("hex");
}
const manualFile = (dir) => join(STATE, "manuals", `${dir.replace(/[^A-Za-z0-9._-]+/g, "_")}.sha`);

const USAGE = `사용법:
  node atcctl.mjs brief                     지난 확인 이후 변화 + 현재 상태 (JSON)
  node atcctl.mjs ack <cursor>              브리핑을 처리했다고 표시 (다음 brief는 이후 변화만)
  node atcctl.mjs issue <세션> <TYPE> [--stand <STAND>] [--flight <FLIGHT>] -- <CLEARANCE 내용>
                                            TYPE: TRAFFIC HOLD CONTINUE LAND REPORT INFO
                                            보낼 대상(SEND TO)과 보낼 문구를 출력한다
  node atcctl.mjs readback <C-0007>         팀이 READBACK함
  node atcctl.mjs cancel <C-0007>           CLEARANCE 취소
  node atcctl.mjs manual check              이 폴더의 CLAUDE.md·/tick이 마지막 ack 뒤 바뀌었는지 (UNCHANGED | CHANGED)
  node atcctl.mjs manual ack                지금 규정을 다시 읽었다고 기록

DISPATCH (OCC 세션이 맡음. 2a 그림자 운용: 제안 검토만, 판정은 SUPERVISOR)
  node atcctl.mjs dispatch brief            계획·열린 제안·2b 점검 (JSON)
  node atcctl.mjs dispatch flight <VOC-193> FLIGHT 본문·댓글 (Linear 읽기 전용)
  node atcctl.mjs dispatch note <D-0003> [--caution] [--hold [<FLIGHT>]]… -- <메모>
                                            제안에 검토 메모를 단다(CAUTION 표시 선택).
                                            --hold <FLIGHT>는 선행 FLIGHT를 지정해 그 제안을 HOLD로 돌린다.
                                            값 없는 --hold는 선행 FLIGHT 없는 HOLD(사람 결정 대기 등, 사유는 메모)
  node atcctl.mjs dispatch release <D-0003> (2b) 승인된 제안을 sent로 바꾸고 SEND TO와 FLIGHT PLAN 출력
  node atcctl.mjs dispatch readback <D-0003>
                                            (2b) CAPTAIN이 READBACK함
  node atcctl.mjs dispatch decline <D-0003> -- <사유>
                                            (2b) CAPTAIN이 맡지 못함
  node atcctl.mjs dispatch recall-send <D-0003>
                                            (2b) SUPERVISOR가 RECALL을 요청한 제안의 SEND TO와 RECALL 문구 출력(재송신도 같은 문구)
  node atcctl.mjs dispatch recalled <D-0003>
                                            (2b) CAPTAIN이 "READBACK D-0003 RECALL"로 답함

FLIGHT FOLLOWING (OCC 세션이 맡음. 읽기 전용: 배정된 FLIGHT의 단계와 지연·불일치)
  node atcctl.mjs following                 FLIGHT마다 단계(READBACK·DEPARTED·PR·CLEARED·ARRIVED)와 문제(issues). fresh는 아직 보고 안 한 문제 (JSON)
  node atcctl.mjs following ack [<key>]…    보고한 문제를 적는다(key 없으면 지금 fresh 전부). 같은 문제는 다시 fresh가 되지 않는다
SCHEDULE (OCC 세션이 맡음. S1 그림자 운용: 초안만. S2 승인 운용: 승인된 작업만 발부해 Linear에 씀. 판정·승인은 SUPERVISOR)
  node atcctl.mjs schedule brief            열린 초안·최근·점검·후보(candidates) (JSON)
  node atcctl.mjs schedule draft CLASSIFY <VOC-193> [--type <TYPE>] [--wake <WAKE>] [--rating <RATING>]… -- <근거>
                                            분류 라벨 초안. TYPE: BUILD MAINT TEST SURVEY CHECK FERRY
                                            WAKE: L M H J · RATING: SEC UI DATA DOCS (--rating은 여러 번)
  node atcctl.mjs schedule draft PRIORITIZE <VOC-193> --priority <1-4> -- <근거>
                                            우선순위 초안. 1 Urgent · 2 High · 3 Medium · 4 Low
  node atcctl.mjs schedule draft CLOSE <VOC-193> -- <근거>
                                            닫기 초안: LOGBOOK에 PR 머지(ARRIVED)가 있는데 Linear가 Done·Canceled가 아님.
                                            PR·머지 시각·Fixes 여부는 atc가 채운다. 발부하지 않는다(SUPERVISOR가 Linear에서 직접)
  node atcctl.mjs schedule draft NEW --title <제목> --project <프로젝트> [--priority <1-4>] [--type <TYPE>] [--wake <WAKE>]
        [--rating <RATING>]… [--tail <TEAM_X>] [--parent <VOC-1>] [--related <VOC-2>]… [--blocked-by <VOC-3>]…
        --reason <근거, "중복 검색: …" 포함> -- <본문>
                                            CHARTER DESK: AD HOC FLIGHT(새 이슈) 초안. 본문의 \n은 줄바꿈.
                                            본문은 네 칸(목표·수정 허용 범위·금지 사항·완료 기준), SEC는 Codex 템플릿
                                            열린 초안이 한도에 차면 LIMIT으로 끝난다(exit 1)
  node atcctl.mjs schedule release <S-0001>  (S2) 승인된 작업을 발부하고 Linear 호출(CALL)을 출력. 각 CALL의 도구에
                                            JSON 입력을 한 글자도 바꾸지 않고 넣는다. 이미 발부됐으면 같은 CALL을 다시 준다

CROSSCHECK (CROSSCHECK 세션이 맡음. SUPERVISOR 판정 전에 다른 모델이 예비 판정을 달아 둔다. 상태는 바꾸지 않음)
  node atcctl.mjs crosscheck brief          mark가 없는 열린 제안·초안(pending)과 최근 SUPERVISOR 판정 예시(examples) (JSON)
  node atcctl.mjs dispatch crosscheck <D-0003> agree|disagree -- <이유>
                                            열린 제안에 예비 판정(이유는 500자 이내). 다시 달면 대신한다
  node atcctl.mjs schedule crosscheck <S-0001> agree|disagree -- <이유>
                                            열린 SCHEDULE 초안에 예비 판정`;

// limit: 409(한도 참)일 때 오류 대신 보여 줄 안내. 호출한 세션이 곧바로 멈추게 LIMIT으로 시작한다.
async function call(method, path, body, { limit } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (limit && res.status === 409) {
    console.error(`LIMIT: ${data.error ?? res.status}\n${limit}`);
    process.exit(1);
  }
  if (!res.ok || data.error) {
    console.error(`오류: ${data.error ?? res.status}`);
    process.exit(1);
  }
  return data;
}

function parseIssue(args) {
  const sep = args.indexOf("--");
  const head = sep < 0 ? args : args.slice(0, sep);
  const text = sep < 0 ? "" : args.slice(sep + 1).join(" ");
  const [to, type, ...rest] = head;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (rest[i] === "--stand") opts.stand = rest[i + 1];
    else if (rest[i] === "--flight") opts.flight = rest[i + 1];
    else throw new Error(`알 수 없는 옵션 ${rest[i]}`);
  }
  if (!to || !type || !text) throw new Error("세션, TYPE, -- 뒤 CLEARANCE 내용이 모두 필요함");
  return { to, type: type.toUpperCase(), text, ...opts };
}

// schedule draft NEW [옵션]… --reason <근거> -- <본문> → POST 본문. OCC guard가 heredoc·리다이렉션을 막아
// 본문은 -- 뒤 인자로 받고, 글자 그대로의 \n을 줄바꿈으로 바꾼다.
const NEW_ONE = ["--title", "--project", "--priority", "--type", "--wake", "--tail", "--parent", "--reason"];
const NEW_MANY = { "--rating": "ratings", "--related": "related", "--blocked-by": "blockedBy" };
function parseNewDraft(args) {
  const sep = args.indexOf("--");
  const head = sep < 0 ? args : args.slice(0, sep);
  const text = sep < 0 ? "" : args.slice(sep + 1).join(" ").replace(/\\n/g, "\n").trim();
  const out = { kind: "NEW" };
  for (let i = 0; i < head.length; i += 2) {
    const [opt, val] = [head[i], head[i + 1]];
    if (!NEW_ONE.includes(opt) && !NEW_MANY[opt]) throw new Error(`NEW에 쓸 수 없는 옵션 ${opt} (가능: ${[...NEW_ONE, ...Object.keys(NEW_MANY)].join(" ")})`);
    if (val === undefined || val.startsWith("--")) throw new Error(`${opt} 뒤에 값이 필요함`);
    if (NEW_MANY[opt]) (out[NEW_MANY[opt]] ??= []).push(val);
    else if (opt.slice(2) in out) throw new Error(`${opt}는 한 번만`);
    else out[opt.slice(2)] = val;
  }
  for (const f of ["title", "project", "reason"]) if (!out[f]?.trim()) throw new Error(`NEW에는 --${f}가 필요함`);
  if (!text) throw new Error("-- 뒤에 본문이 필요함");
  return { ...out, body: text };
}

// schedule draft <KIND> <FLIGHT> [옵션]… -- <근거> → POST /api/schedule/ops 본문. 값 검사는 서버가 한다.
const DRAFT_OPTS = { CLASSIFY: ["--type", "--wake", "--rating"], PRIORITIZE: ["--priority"], CLOSE: [] };
export function parseDraft(args) {
  if (String(args[0] ?? "").toUpperCase() === "NEW") return parseNewDraft(args.slice(1));
  const sep = args.indexOf("--");
  const head = sep < 0 ? args : args.slice(0, sep);
  const reason = sep < 0 ? "" : args.slice(sep + 1).join(" ").trim();
  const [kindRaw, flight, ...rest] = head;
  const kind = String(kindRaw ?? "").toUpperCase();
  if (!DRAFT_OPTS[kind]) throw new Error(`모르는 SCHEDULE 작업: ${kindRaw ?? "(없음)"} (가능: ${[...Object.keys(DRAFT_OPTS), "NEW"].join(", ")})`);
  if (!flight || flight.startsWith("--")) throw new Error("FLIGHT key가 필요함 (예: VOC-193)");
  const body = { kind, flight };
  for (let i = 0; i < rest.length; i += 2) {
    const [opt, val] = [rest[i], rest[i + 1]];
    if (!DRAFT_OPTS[kind].includes(opt)) throw new Error(DRAFT_OPTS[kind].length ? `${kind}에 쓸 수 없는 옵션 ${opt} (가능: ${DRAFT_OPTS[kind].join(" ")})` : `${kind}에는 옵션이 없음(${opt}) — PR·머지 시각은 atc가 채운다`);
    if (val === undefined || val.startsWith("--")) throw new Error(`${opt} 뒤에 값이 필요함`);
    if (opt === "--rating") (body.ratings ??= []).push(val);
    else body[opt.slice(2)] = val;
  }
  if (kind === "PRIORITIZE" && body.priority === undefined) throw new Error("PRIORITIZE에는 --priority <1-4>가 필요함");
  if (!reason) throw new Error("-- 뒤에 근거 한 줄이 필요함");
  return { ...body, reason };
}

// dispatch|schedule crosscheck <ID> agree|disagree -- <이유> → POST 본문. 값 검사(500자 등)는 서버가 한다.
// 모델 이름은 세션이 적지 않는다: CROSSCHECK guard가 세션 기록에서 실제 모델을 확인해 ATC_CROSSCHECK_MODEL로 붙인다
// (없으면 서버가 "unknown").
export function parseCrosscheck(args) {
  const sep = args.indexOf("--");
  const head = sep < 0 ? args : args.slice(0, sep);
  const reason = sep < 0 ? "" : args.slice(sep + 1).join(" ").trim();
  const [id, verdict, ...rest] = head;
  if (!id || id.startsWith("--")) throw new Error("제안·초안 ID가 필요함 (예: D-0003, S-0001)");
  if (verdict !== "agree" && verdict !== "disagree") throw new Error("판정은 agree|disagree");
  if (rest.length) throw new Error(`알 수 없는 인자 ${rest.join(" ")}`);
  if (!reason) throw new Error("-- 뒤에 이유 한 줄이 필요함");
  const body = { verdict, reason, by: process.env.ATC_CROSSCHECK_BY || "CROSSCHECK" };
  if (process.env.ATC_CROSSCHECK_MODEL) body.model = process.env.ATC_CROSSCHECK_MODEL;
  return { id, body };
}

// crosscheck brief: 두 브리핑에서 CROSSCHECK에 필요한 것만 모은다(FLIGHT 제목·상태 포함)
export function crosscheckBrief(dispatch, schedule) {
  const pick = (flights, keys) => Object.fromEntries(keys.filter((k) => k && flights?.[k]).map((k) => [k, flights[k]]));
  const part = (b) => {
    const cc = b.crosscheck ?? { pending: [], examples: [] };
    return { mode: b.mode, pending: cc.pending, examples: cc.examples, flights: pick(b.flights, [...cc.pending, ...cc.examples].map((x) => x.flight)) };
  };
  return { dispatch: part(dispatch), schedule: part(schedule), rate: { dispatch: dispatch.gate?.crosscheck ?? null, schedule: schedule.gate?.crosscheck ?? null } };
}

const PRIORITY = { 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" };
export function payloadText(op) {
  const p = op.payload;
  if (op.kind === "PRIORITIZE") return `priority ${p.priority}(${PRIORITY[p.priority]})`;
  if (op.kind === "CLOSE") return `→ Done · PR ${p.pr.repo.split("/").pop()}#${p.pr.number} 머지 ${p.mergedAt.slice(0, 16)}Z · ${p.partOf ? "Part of(일부만)" : p.fixes ? "Fixes" : "본문에 Fixes 없음"}`;
  const labels = [p.type && `type:${p.type}`, p.wake && `wake:${p.wake}`, ...(p.ratings ?? []).map((r) => `rating:${r}`)];
  if (op.kind !== "NEW") return labels.filter(Boolean).join(" ");
  return [p.project, p.priority ? PRIORITY[p.priority] : "priority 없음", [...labels, p.tail && `tail:${p.tail}`].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
}

// 초안 결과 출력. NEW는 AD HOC FLIGHT 초안과 atc가 찾은 비슷한 FLIGHT 목록.
export function draftText(op) {
  const shadow = "(그림자 운용, Linear에 쓰지 않음)";
  if (op.kind !== "NEW") return `${op.id} ${op.kind} ${op.flight} 초안 · ${payloadText(op)} ${shadow}`;
  const similar = op.payload.similar ?? [];
  return [
    `${op.id} AD HOC FLIGHT 초안 · ${op.payload.title}`,
    `  ${payloadText(op)} ${shadow}`,
    similar.length ? `  비슷한 FLIGHT ${similar.length}건:` : "  비슷한 FLIGHT 없음",
    ...similar.map((x) => `    ${x.key} ${x.title}`),
  ].join("\n");
}

// 테스트가 import할 때는 CLI를 돌리지 않는다
const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    if (cmd === "brief") {
      console.log(JSON.stringify(await call("GET", "/api/controller/brief?consumer=controller"), null, 1));
    } else if (cmd === "ack" && args[0]) {
      await call("POST", "/api/controller/ack", { consumer: "controller", cursor: args[0] });
      console.log(`ack ${args[0]}`);
    } else if (cmd === "issue") {
      const r = await call("POST", "/api/clearances", parseIssue(args));
      console.log(`SEND TO: ${r.sendTo}\n---\n${r.message}`);
    } else if (cmd === "dispatch" && args[0] === "brief") {
      console.log(JSON.stringify(await call("GET", "/api/dispatch/brief"), null, 1));
    } else if (cmd === "dispatch" && args[0] === "flight" && args[1]) {
      console.log(JSON.stringify(await call("GET", `/api/dispatch/flight/${encodeURIComponent(args[1])}`), null, 1));
    } else if (cmd === "dispatch" && args[0] === "note" && args[1]) {
      const sep = args.indexOf("--");
      const text = sep < 0 ? "" : args.slice(sep + 1).join(" ");
      if (!text) throw new Error("-- 뒤에 메모가 필요함");
      const head = args.slice(2, sep < 0 ? undefined : sep);
      const blockedBy = [];
      let hold = false;
      for (let i = 0; i < head.length; i++) {
        if (head[i] === "--hold") {
          hold = true;
          if (head[i + 1] && !head[i + 1].startsWith("--")) blockedBy.push(head[++i]);
        } else if (head[i] !== "--caution") {
          throw new Error(`알 수 없는 옵션 ${head[i]}`);
        }
      }
      const r = await call("POST", `/api/dispatch/proposals/${encodeURIComponent(args[1])}/note`, { text, caution: head.includes("--caution") });
      if (hold) await call("POST", `/api/dispatch/proposals/${encodeURIComponent(args[1])}/hold`, { blockedBy });
      const holdText = !hold ? "" : blockedBy.length ? ` · HOLD (선행 ${blockedBy.join(", ")})` : " · HOLD (선행 FLIGHT 없음, 사유는 메모)";
      console.log(`${r.proposal.id} 메모${r.proposal.caution ? " · CAUTION" : ""}${holdText}`);
    } else if (cmd === "dispatch" && args[0] === "release" && args[1]) {
      const r = await call("POST", `/api/dispatch/proposals/${encodeURIComponent(args[1])}/release`);
      console.log(`SEND TO: ${r.sendTo}\n---\n${r.message}`);
    } else if (cmd === "dispatch" && args[0] === "readback" && args[1]) {
      const r = await call("POST", `/api/dispatch/proposals/${encodeURIComponent(args[1])}/accept`);
      console.log(`${r.proposal.id} READBACK 확인`);
    } else if (cmd === "dispatch" && args[0] === "recall-send" && args[1]) {
      const r = await call("POST", `/api/dispatch/proposals/${encodeURIComponent(args[1])}/recall-send`);
      console.log(`SEND TO: ${r.sendTo}\n---\n${r.message}`);
    } else if (cmd === "dispatch" && args[0] === "recalled" && args[1]) {
      const r = await call("POST", `/api/dispatch/proposals/${encodeURIComponent(args[1])}/recalled`);
      console.log(`${r.proposal.id} RECALLED — FLIGHT는 다시 후보(같은 AIRCRAFT에는 24시간 제안하지 않음)`);
    } else if (cmd === "dispatch" && args[0] === "decline" && args[1]) {
      const sep = args.indexOf("--");
      const reason = sep < 0 ? "" : args.slice(sep + 1).join(" ");
      if (!reason) throw new Error("-- 뒤에 CAPTAIN의 사유가 필요함");
      const r = await call("POST", `/api/dispatch/proposals/${encodeURIComponent(args[1])}/decline`, { reason });
      console.log(`${r.proposal.id} DECLINED`);
    } else if (cmd === "schedule" && args[0] === "brief") {
      console.log(JSON.stringify(await call("GET", "/api/schedule/brief"), null, 1));
    } else if (cmd === "schedule" && args[0] === "draft" && args[1]) {
      const r = await call("POST", "/api/schedule/ops", parseDraft(args.slice(1)), {
        limit: "이번 바퀴는 SCHEDULE 초안을 더 쓰지 않는다(열린 초안 한도).",
      });
      console.log(draftText(r.op));
    } else if (cmd === "schedule" && args[0] === "release" && args[1]) {
      const r = await call("POST", `/api/schedule/ops/${encodeURIComponent(args[1])}/release`);
      // OCC는 CALL마다 그 Linear MCP 도구를 JSON 입력 그대로 부른다(linear-guard가 비교한다)
      console.log(`${r.op.id} RELEASED · ${r.calls.length} CALL`);
      r.calls.forEach((c, i) => console.log(`CALL ${i + 1}/${r.calls.length} · ${c.tool}\n${JSON.stringify(c.input)}`));
    } else if (cmd === "following" && !args[0]) {
      console.log(JSON.stringify(await call("GET", "/api/following"), null, 1));
    } else if (cmd === "following" && args[0] === "ack") {
      const r = await call("POST", "/api/following/ack", args.length > 1 ? { keys: args.slice(1) } : {});
      console.log(`ACK ${r.acked.length}건 (보고한 문제 ${r.reported}건 기억)`);
    } else if (cmd === "crosscheck" && args[0] === "brief") {
      const [d, s] = await Promise.all([call("GET", "/api/dispatch/brief"), call("GET", "/api/schedule/brief")]);
      console.log(JSON.stringify(crosscheckBrief(d, s), null, 1));
    } else if ((cmd === "dispatch" || cmd === "schedule") && args[0] === "crosscheck") {
      const { id, body } = parseCrosscheck(args.slice(1));
      const path = cmd === "dispatch" ? `/api/dispatch/proposals/${encodeURIComponent(id)}/crosscheck` : `/api/schedule/ops/${encodeURIComponent(id)}/crosscheck`;
      const r = await call("POST", path, body);
      const x = r.proposal ?? r.op;
      console.log(`${x.id} CROSSCHECK ${x.crosscheck.verdict} · ${x.crosscheck.reason} (${x.crosscheck.model} · 예비 판정, 상태 그대로 ${x.status})`);
    } else if (cmd === "manual" && (args[0] === "check" || args[0] === "ack")) {
      const dir = process.cwd();
      const now = manualHash(dir);
      const file = manualFile(dir);
      if (args[0] === "ack") {
        mkdirSync(join(STATE, "manuals"), { recursive: true });
        writeFileSync(file, now + "\n");
        console.log(`ACK ${now.slice(0, 8)}`);
      } else {
        let last = "";
        try {
          last = readFileSync(file, "utf8").trim();
        } catch {}
        console.log(
          last === now
            ? `UNCHANGED ${now.slice(0, 8)}`
            : `CHANGED ${now.slice(0, 8)} — CLAUDE.md와 .claude/skills/tick/SKILL.md를 다시 읽은 뒤 \`manual ack\``,
        );
      }
    } else if ((cmd === "readback" || cmd === "cancel") && args[0]) {
      const r = await call("POST", `/api/clearances/${encodeURIComponent(args[0])}/${cmd}`);
      console.log(`${r.clearance.id} ${cmd === "readback" ? "READBACK 확인" : "취소"}`);
    } else {
      console.log(USAGE);
      process.exit(cmd ? 1 : 0);
    }
  } catch (e) {
    console.error(`오류: ${e.message}`);
    process.exit(1);
  }
}
