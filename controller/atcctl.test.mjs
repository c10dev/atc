import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CREW_CHANGE_CMDS, crosscheckBrief, draftText, manualFiles, manualHash, parseArrived, parseBriefingArgs, parseCrewChange, parseCrosscheck, parseDraft, parseLandingReview, parseMccArgs, mccText, payloadText } from "./atcctl.mjs";
import { simpleCommands } from "../hooks/shell.mjs";

const argv = (s) => s.split(" ");

test("CLASSIFY: --rating은 여러 번, 근거는 -- 뒤 전부", () => {
  assert.deepEqual(parseDraft(argv("classify VOC-195 --type MAINT --wake M --rating SEC --rating DATA -- 잠금 경쟁 -- 수정")), {
    kind: "CLASSIFY",
    flight: "VOC-195",
    type: "MAINT",
    wake: "M",
    ratings: ["SEC", "DATA"],
    reason: "잠금 경쟁 -- 수정",
  });
});

test("CLASSIFY: 옵션 하나만", () => {
  assert.deepEqual(parseDraft(argv("CLASSIFY VOC-1 --wake L -- 한 줄")), { kind: "CLASSIFY", flight: "VOC-1", wake: "L", reason: "한 줄" });
});

test("PRIORITIZE: --priority", () => {
  assert.deepEqual(parseDraft(argv("PRIORITIZE VOC-177 --priority 2 -- 본문에 기한")), { kind: "PRIORITIZE", flight: "VOC-177", priority: "2", reason: "본문에 기한" });
});

const bad = [
  ["모르는 작업", "LINK VOC-1 -- x", /모르는 SCHEDULE 작업/],
  ["작업 없음", "", /모르는 SCHEDULE 작업/],
  ["FLIGHT 없음", "CLASSIFY -- x", /FLIGHT key/],
  ["FLIGHT 자리에 옵션", "CLASSIFY --type BUILD -- x", /FLIGHT key/],
  ["근거 없음", "CLASSIFY VOC-1 --type BUILD", /근거/],
  ["빈 근거", "CLASSIFY VOC-1 --type BUILD --", /근거/],
  ["CLASSIFY에 --priority", "CLASSIFY VOC-1 --priority 1 -- x", /쓸 수 없는 옵션 --priority/],
  ["PRIORITIZE에 --type", "PRIORITIZE VOC-1 --type BUILD --priority 1 -- x", /쓸 수 없는 옵션 --type/],
  ["PRIORITIZE에 --priority 없음", "PRIORITIZE VOC-1 -- x", /--priority <1-4>가 필요/],
  ["값 없는 옵션", "CLASSIFY VOC-1 --wake -- x", /--wake 뒤에 값/],
  ["값 자리에 옵션", "CLASSIFY VOC-1 --type --wake M -- x", /--type 뒤에 값/],
];
for (const [name, s, re] of bad) test(`거부: ${name}`, () => assert.throws(() => parseDraft(s ? argv(s) : []), re));

test("payloadText", () => {
  assert.equal(payloadText({ kind: "CLASSIFY", payload: { type: "MAINT", wake: "M", ratings: ["SEC"] } }), "type:MAINT wake:M rating:SEC");
  assert.equal(payloadText({ kind: "CLASSIFY", payload: { ratings: ["UI"] } }), "rating:UI");
  assert.equal(payloadText({ kind: "PRIORITIZE", payload: { priority: 3 } }), "priority 3(Medium)");
});

// ── NEW (CHARTER DESK, AD HOC FLIGHT 초안) ──

// OCC가 실제로 칠 명령: 여러 단어 인자는 따옴표, 본문은 작은따옴표 안에 \n
const NEW_CMD = `node ../controller/atcctl.mjs schedule draft NEW --title "Practice 시트: 머리 줄 #2 맞추기" --project "Web UX" --priority 3 --type BUILD --wake M --rating UI --tail TEAM_E --related VOC-60 --related VOC-61 --blocked-by VOC-52 --reason "SUPERVISOR 요청. 중복 검색: VOC-179 비슷함(범위 다름)" -- '## 목표\n머리 줄 정렬\n## 수정 허용 범위\n- \`src/app/**\`\n## 금지 사항\n- DB\n## 완료 기준\n- 390px 확인'`;

test("NEW: 셸이 나눈 인자 그대로 파싱, 본문의 \\n은 줄바꿈", () => {
  const [words] = simpleCommands(NEW_CMD);
  assert.deepEqual(parseDraft(words.slice(4)), {
    kind: "NEW",
    title: "Practice 시트: 머리 줄 #2 맞추기",
    project: "Web UX",
    priority: "3",
    type: "BUILD",
    wake: "M",
    ratings: ["UI"],
    tail: "TEAM_E",
    related: ["VOC-60", "VOC-61"],
    blockedBy: ["VOC-52"],
    reason: "SUPERVISOR 요청. 중복 검색: VOC-179 비슷함(범위 다름)",
    body: "## 목표\n머리 줄 정렬\n## 수정 허용 범위\n- `src/app/**`\n## 금지 사항\n- DB\n## 완료 기준\n- 390px 확인",
  });
  assert.equal(parseDraft(["new", "--title", "t", "--project", "p", "--reason", "r", "--", "a", "b\\nc"]).body, "a b\nc");
});

const badNew = [
  ["제목 없음", ["NEW", "--project", "p", "--reason", "r", "--", "b"], /--title가 필요/],
  ["프로젝트 없음", ["NEW", "--title", "t", "--reason", "r", "--", "b"], /--project가 필요/],
  ["근거 없음", ["NEW", "--title", "t", "--project", "p", "--", "b"], /--reason가 필요/],
  ["본문 없음", ["NEW", "--title", "t", "--project", "p", "--reason", "r"], /본문이 필요/],
  ["모르는 옵션", ["NEW", "--flight", "VOC-1", "--", "b"], /NEW에 쓸 수 없는 옵션 --flight/],
  ["값 없는 옵션", ["NEW", "--title", "--project", "p", "--", "b"], /--title 뒤에 값/],
  ["한 번만 쓰는 옵션", ["NEW", "--title", "a", "--title", "b", "--", "b"], /한 번만/],
];
for (const [name, args, re] of badNew) test(`NEW 거부: ${name}`, () => assert.throws(() => parseDraft(args), re));

test("draftText: NEW는 AD HOC FLIGHT 초안과 비슷한 FLIGHT", () => {
  const op = { id: "S-0007", kind: "NEW", flight: null, payload: { title: "재생 버튼 정리", project: "Web UX", type: "BUILD", tail: "TEAM_E", similar: [{ key: "VOC-60", title: "재생 화면 버튼" }] } };
  assert.equal(
    draftText(op),
    "S-0007 AD HOC FLIGHT 초안 · 재생 버튼 정리\n  Web UX · priority 없음 · type:BUILD tail:TEAM_E (그림자 운용, Linear에 쓰지 않음)\n  비슷한 FLIGHT 1건:\n    VOC-60 재생 화면 버튼",
  );
  assert.match(draftText({ ...op, payload: { ...op.payload, priority: 2, similar: [] } }), /Web UX · High · .*\n  비슷한 FLIGHT 없음$/);
  assert.equal(draftText({ id: "S-0001", kind: "CLASSIFY", flight: "VOC-1", payload: { wake: "L" } }), "S-0001 CLASSIFY VOC-1 초안 · wake:L (그림자 운용, Linear에 쓰지 않음)");
});

test("OCC guard(--gh-read)는 현실적인 NEW 명령을 통과시킨다: 따옴표 인자, 한국어, #, :, 본문의 \\n과 백틱", async () => {
  const { check } = await import("./guard.mjs");
  const OCC = new URL("../occ", import.meta.url).pathname;
  assert.equal(check(NEW_CMD, OCC, { ghRead: true }), null);
});

test("crosscheck: <ID> agree|disagree -- <이유>", () => {
  const saved = process.env.ATC_CROSSCHECK_MODEL;
  delete process.env.ATC_CROSSCHECK_MODEL;
  assert.deepEqual(parseCrosscheck(argv("D-0003 disagree -- 이미 완료됨 -- PR #390")), { id: "D-0003", body: { verdict: "disagree", reason: "이미 완료됨 -- PR #390", by: "CROSSCHECK" } });
  process.env.ATC_CROSSCHECK_MODEL = "muse";
  assert.equal(parseCrosscheck(argv("D-0003 agree -- x")).body.model, "muse"); // 모델은 환경(settings env)에서
  if (saved === undefined) delete process.env.ATC_CROSSCHECK_MODEL;
  else process.env.ATC_CROSSCHECK_MODEL = saved;
  assert.throws(() => parseCrosscheck(argv("D-0003 maybe -- x")), /agree\|disagree/);
  assert.throws(() => parseCrosscheck(argv("D-0003 agree")), /이유/);
  assert.throws(() => parseCrosscheck(argv("-- x")), /ID/);
  assert.throws(() => parseCrosscheck(argv("D-0003 agree --caution -- x")), /알 수 없는 인자/);
});

test("crosscheck brief: 두 브리핑의 pending·examples와 그 FLIGHT만", () => {
  const d = { mode: "shadow", gate: { crosscheck: { marked: 1, matched: 1, rate: 1 } }, flights: { "VOC-1": { title: "a" }, "VOC-9": { title: "z" } },
    crosscheck: { pending: [{ id: "D-0001", flight: "VOC-1" }], examples: [] } };
  const s = { mode: "approval", gate: {}, flights: { "VOC-2": { title: "b" } }, crosscheck: { pending: [], examples: [{ id: "S-0001", flight: "VOC-2", verdict: "agree", reason: null }] } };
  const out = crosscheckBrief(d, s);
  assert.deepEqual(out.dispatch.flights, { "VOC-1": { title: "a" } });
  assert.deepEqual(out.schedule.flights, { "VOC-2": { title: "b" } });
  assert.deepEqual(out.rate, { dispatch: { marked: 1, matched: 1, rate: 1 }, schedule: null });
  assert.deepEqual(crosscheckBrief({ mode: "shadow" }, { mode: "shadow" }).dispatch.pending, []);
});

test("schedule brief: OCC 보정 예시(examples)가 JSON 출력에 그대로 나온다", async () => {
  const { createServer } = await import("node:http");
  const { execFile } = await import("node:child_process");
  const brief = { mode: "shadow", open: [], candidates: { classify: [], prioritize: [] }, examples: [{ id: "S-0001", kind: "CLASSIFY", flight: "VOC-195", proposed: { type: "BUILD" }, draft: "d", verdict: "disagree", reason: "FLIGHT TYPE은 MAINT — fleet.md 4.1" }] };
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.url === "/api/schedule/brief" ? brief : { error: "nope" }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const out = await new Promise((resolve, reject) =>
      execFile(process.execPath, [new URL("./atcctl.mjs", import.meta.url).pathname, "schedule", "brief"], { env: { ...process.env, ATC_URL: url } }, (err, stdout) => (err ? reject(err) : resolve(stdout))),
    );
    assert.deepEqual(JSON.parse(out).examples, brief.examples);
  } finally {
    server.close();
  }
});

test("dispatch arrived: <D-ID> -- <결과 링크나 한 줄>", () => {
  assert.deepEqual(parseArrived(argv("D-0012 -- https://github.com/o/r/pull/401#pullrequestreview-1 리뷰 남김")), {
    id: "D-0012",
    body: { note: "https://github.com/o/r/pull/401#pullrequestreview-1 리뷰 남김" },
  });
  assert.deepEqual(parseArrived(argv("D-0012 -- 조사 결과 -- 세 가지")).body.note, "조사 결과 -- 세 가지");
  assert.throws(() => parseArrived(argv("D-0012")), /CAPTAIN 보고/);
  assert.throws(() => parseArrived(argv("D-0012 --")), /CAPTAIN 보고/);
  assert.throws(() => parseArrived([]), /제안 ID/);
  assert.throws(() => parseArrived(argv("-- x")), /제안 ID/);
  assert.throws(() => parseArrived(argv("D-0012 extra -- x")), /알 수 없는 인자/);
  // 직접 배정된 STAND 없는 FLIGHT(ATC-72): FLIGHT key와 --aircraft
  assert.deepEqual(parseArrived(argv("voc-211 --aircraft TEAM_G -- https://docs.example/r1")), { flight: "VOC-211", body: { note: "https://docs.example/r1", aircraft: "TEAM_G" } });
  assert.deepEqual(parseArrived(argv("VOC-211 --aircraft=TEAM_G -- done")).body.aircraft, "TEAM_G");
  assert.throws(() => parseArrived(argv("VOC-211 -- done")), /--aircraft/);
  assert.throws(() => parseArrived(argv("D-0012 --aircraft TEAM_G -- done")), /D-xxxx에는 --aircraft/);
  assert.throws(() => parseArrived(argv("hello --aircraft TEAM_G -- done")), /FLIGHT key가 아님/);
});

test("CLOSE 초안: FLIGHT와 근거만, 옵션은 받지 않는다(PR·머지 시각은 atc가 채운다)", () => {
  assert.deepEqual(parseDraft(argv("close VOC-193 -- PR 400 머지, Fixes VOC-193")), { kind: "CLOSE", flight: "VOC-193", reason: "PR 400 머지, Fixes VOC-193" });
  assert.throws(() => parseDraft(argv("CLOSE VOC-193 --type BUILD -- x")), /CLOSE에는 옵션이 없음/);
  assert.throws(() => parseDraft(argv("CLOSE VOC-193")), /근거/);
  const op = { id: "S-0009", kind: "CLOSE", flight: "VOC-193", payload: { pr: { repo: "o/vocado_nextjs", number: 400, url: "" }, mergedAt: "2026-09-26T13:41:00Z", fixes: true } };
  assert.equal(payloadText(op), "→ Done · PR vocado_nextjs#400 머지 2026-09-26T13:41Z · Fixes");
  assert.equal(draftText(op), "S-0009 CLOSE VOC-193 초안 · → Done · PR vocado_nextjs#400 머지 2026-09-26T13:41Z · Fixes (그림자 운용, Linear에 쓰지 않음)");
});

test("TAIL 초안: FLIGHT와 REGISTRATION 하나, 근거(ATC-68)", () => {
  assert.deepEqual(parseDraft(argv("tail VOC-196 team_e -- President가 TEAM_E에 직접 배정")), { kind: "TAIL", flight: "VOC-196", registration: "TEAM_E", reason: "President가 TEAM_E에 직접 배정" });
  assert.throws(() => parseDraft(argv("TAIL VOC-196 -- x")), /REGISTRATION/);
  assert.throws(() => parseDraft(argv("TAIL -- x")), /FLIGHT key/);
  assert.throws(() => parseDraft(argv("TAIL VOC-196 TEAM_E")), /근거/);
  assert.throws(() => parseDraft(argv("TAIL VOC-196 TEAM_E --wake M -- x")), /TAIL에는 옵션이 없음/);
  const op = { id: "S-0012", kind: "TAIL", flight: "VOC-196", payload: { registration: "TEAM_E" } };
  assert.equal(draftText(op), "S-0012 TAIL VOC-196 초안 · tail:TEAM_E (그림자 운용, Linear에 쓰지 않음)");
  assert.equal(payloadText({ ...op, payload: { registration: "TEAM_E", caution: "다른 팀의 tail:을 바꿈 — TEAM_A가 AIRBORNE" } }), "tail:TEAM_E · CAUTION 다른 팀의 tail:을 바꿈 — TEAM_A가 AIRBORNE");
});

test("WAYPOINT 초안: FLIGHT와 마일스톤 이름(빈칸 이어 붙임)이나 id, 근거(ATC-77)", () => {
  assert.deepEqual(parseDraft(argv("waypoint VOC-201 Beta Ready -- 완료 기준 2가 이 FLIGHT")), { kind: "WAYPOINT", flight: "VOC-201", milestone: "Beta Ready", reason: "완료 기준 2가 이 FLIGHT" });
  assert.deepEqual(parseDraft(["WAYPOINT", "VOC-201", "Beta Ready", "--", "x"]).milestone, "Beta Ready");
  assert.throws(() => parseDraft(argv("WAYPOINT VOC-201 -- x")), /마일스톤/);
  assert.throws(() => parseDraft(argv("WAYPOINT -- x")), /FLIGHT key/);
  assert.throws(() => parseDraft(argv("WAYPOINT VOC-201 M1")), /근거/);
  assert.throws(() => parseDraft(argv("WAYPOINT VOC-201 M1 --gap -- x")), /WAYPOINT에는 옵션이 없음/);
  const op = { id: "S-0020", kind: "WAYPOINT", flight: "VOC-201", payload: { route: "Song Catalog", milestone: { id: "m-2", name: "Beta Ready" } } };
  assert.equal(draftText(op), "S-0020 WAYPOINT VOC-201 초안 · WAYPOINT Song Catalog · Beta Ready (그림자 운용, Linear에 쓰지 않음)");
});

test("dispatch crosscheck --code: 쉼표·여러 번, disagree에만", () => {
  assert.deepEqual(parseCrosscheck(argv("D-0022 disagree --code needs-human,waiting-on-prior --code needs-human -- 사용자 지시를 기다림")).body.reasonCodes, ["needs-human", "waiting-on-prior"]);
  assert.equal(parseCrosscheck(argv("D-0022 disagree -- x")).body.reasonCodes, undefined);
  assert.throws(() => parseCrosscheck(argv("D-0022 agree --code needs-human -- x")), /disagree에만/);
  assert.throws(() => parseCrosscheck(argv("D-0022 disagree --code -- x")), /사유 코드가 필요함/);
  assert.throws(() => parseCrosscheck(argv("D-0022 disagree --flag x -- y")), /알 수 없는 인자/);
});

test("crew-change: brief | send <CC-ID> | readback <CC-ID>. 승인(approve)은 없다", () => {
  assert.deepEqual(CREW_CHANGE_CMDS, ["brief", "send", "readback"]);
  assert.deepEqual(parseCrewChange(argv("brief")), { action: "brief" });
  assert.deepEqual(parseCrewChange(argv("send CC-0003")), { action: "send", id: "CC-0003" });
  assert.deepEqual(parseCrewChange(argv("readback cc-0003")), { action: "readback", id: "CC-0003" });
  assert.throws(() => parseCrewChange(argv("approve CC-0003")), /승인은 SUPERVISOR/);
  assert.throws(() => parseCrewChange(argv("delivered CC-0003")), /brief\|send\|readback/);
  assert.throws(() => parseCrewChange([]), /brief\|send\|readback/);
  assert.throws(() => parseCrewChange(argv("send")), /CREW CHANGE ID/);
  assert.throws(() => parseCrewChange(argv("send D-0003")), /CREW CHANGE ID/);
  assert.throws(() => parseCrewChange(argv("send CC-3")), /CREW CHANGE ID/);
  assert.throws(() => parseCrewChange(argv("readback CC-0003 extra")), /알 수 없는 인자/);
  assert.throws(() => parseCrewChange(argv("brief CC-0003")), /알 수 없는 인자/);
});

test("crew-change send·readback: 서버 창구를 부르고 SEND TO와 문구를 그대로 출력한다", async () => {
  const { createServer } = await import("node:http");
  const { execFile } = await import("node:child_process");
  const message = '[OCC CC-0003] CREW CHANGE · HOTEL (TEAM_H)\n\n본문\n\n— 받았으면 이 메시지에 "READBACK CC-0003"로 답장해 주세요.';
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/fleet/crew-changes/CC-0003/send") return res.end(JSON.stringify({ change: { id: "CC-0003" }, sendTo: "TEAM_H", message }));
    if (req.url === "/api/fleet/crew-changes/CC-0003/readback") return res.end(JSON.stringify({ ok: true, change: { id: "CC-0003", registration: "TEAM_H" } }));
    res.statusCode = 409;
    res.end(JSON.stringify({ error: "CC-0004는 보낼 상태가 아님(pending)" }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const run = (...args) =>
    new Promise((resolve) =>
      execFile(process.execPath, [new URL("./atcctl.mjs", import.meta.url).pathname, "crew-change", ...args], { env: { ...process.env, ATC_URL: url } }, (err, stdout, stderr) =>
        resolve({ code: err?.code ?? 0, stdout, stderr }),
      ),
    );
  try {
    assert.equal((await run("send", "cc-0003")).stdout, `SEND TO: TEAM_H\n---\n${message}\n`);
    assert.equal((await run("readback", "CC-0003")).stdout, "CC-0003 READBACK 확인 (TEAM_H)\n");
    const refused = await run("send", "CC-0004");
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /보낼 상태가 아님\(pending\)/);
    assert.deepEqual(seen, ["POST /api/fleet/crew-changes/CC-0003/send", "POST /api/fleet/crew-changes/CC-0003/readback", "POST /api/fleet/crew-changes/CC-0004/send"]);
  } finally {
    server.close();
  }
});

test("dispatch briefing: <D-ID> --what --why --risk 세 줄 모두", () => {
  const args = ["D-0012", "--what", "재생 화면 버튼 정리", "--why", "TEAM_F가 같은 ROUTE를 막 끝냈다", "--risk", "디자인 확인 필요"];
  assert.deepEqual(parseBriefingArgs(args), { id: "D-0012", body: { what: "재생 화면 버튼 정리", why: "TEAM_F가 같은 ROUTE를 막 끝냈다", risk: "디자인 확인 필요" } });
  assert.throws(() => parseBriefingArgs(["D-0012", "--what", "a", "--why", "b"]), /--risk가 필요함/);
  assert.throws(() => parseBriefingArgs(["D-0012", "--what", "--why", "b"]), /--what 뒤에 한 줄/);
  assert.throws(() => parseBriefingArgs(["D-0012", "--what", "a", "--what", "b"]), /두 번/);
  assert.throws(() => parseBriefingArgs(["D-0012", "--note", "a"]), /알 수 없는 인자/);
  assert.throws(() => parseBriefingArgs(["--what", "a"]), /제안 ID/);
});

test("NEW --milestone·--gap: WAYPOINT gap 초안(ATC-8)", () => {
  const got = parseDraft(["NEW", "--gap", "--title", "t", "--project", "Song Experience", "--milestone", "Beta Ready", "--reason", "r", "--", "b"]);
  assert.deepEqual(got, { kind: "NEW", gap: true, title: "t", project: "Song Experience", milestone: "Beta Ready", reason: "r", body: "b" });
  assert.equal(parseDraft(["NEW", "--title", "t", "--project", "p", "--reason", "r", "--", "b"]).gap, undefined);
  assert.throws(() => parseDraft(["NEW", "--title", "t", "--project", "p", "--milestone", "--reason", "r", "--", "b"]), /--milestone 뒤에 값/);
});

test("landing review(ATC-7·27): 읽기는 대상만, 기록은 --head·--verdict·리뷰 글. 모델은 REVIEW guard가 붙인 환경에서", () => {
  assert.deepEqual(parseLandingReview(argv("vocado_nextjs#391")), { path: "/api/landing/review/vocado_nextjs/391", write: null });
  assert.equal(parseLandingReview(argv("chaehy5665/vocado_nextjs#391")).path, "/api/landing/review/chaehy5665%2Fvocado_nextjs/391");
  const saved = process.env.ATC_REVIEW_MODEL;
  process.env.ATC_REVIEW_MODEL = "deepseek-v4.1-flash"; // REVIEW guard가 붙이는 실제 모델
  const w = parseLandingReview(argv("vocado_nextjs#391 --head abc1234 --verdict findings -- P1 폴백 경로에서 캐시를 지우지 않음"));
  if (saved === undefined) delete process.env.ATC_REVIEW_MODEL;
  else process.env.ATC_REVIEW_MODEL = saved;
  assert.deepEqual(w.write, { head: "abc1234", verdict: "findings", text: "P1 폴백 경로에서 캐시를 지우지 않음", by: "REVIEW", model: "deepseek-v4.1-flash" });
  assert.throws(() => parseLandingReview(argv("391")), /<repo>#<PR>/);
  assert.throws(() => parseLandingReview(argv("v#1 --verdict pass -- ok")), /--head/);
  assert.throws(() => parseLandingReview(argv("v#1 --head abc1234 --verdict maybe -- ok")), /pass\|findings/);
  assert.throws(() => parseLandingReview(argv("v#1 --head abc1234 --verdict pass")), /리뷰 내용/);
  assert.throws(() => parseLandingReview(argv("v#1 --head abc1234 --verdict pass --model x -- ok")), /알 수 없는 인자/);
});

test("mcc(docs/mcc.md): queue·packet은 읽기, inspect는 --head·--verdict·글, land는 --head만, 모델은 MCC guard가 붙인 환경에서", () => {
  assert.deepEqual(parseMccArgs(argv("queue")), { method: "GET", path: "/api/mcc/queue" });
  const saved = process.env.ATC_MCC_MODEL;
  delete process.env.ATC_MCC_MODEL; // TOWER·OCC처럼 guard가 모델을 붙이지 않은 세션: 서버가 거절한다
  assert.deepEqual(parseMccArgs(argv("rts")), { method: "POST", path: "/api/mcc/rts", body: {} });
  process.env.ATC_MCC_MODEL = "claude-opus-5-5"; // MCC guard가 붙이는 실제 모델
  const rts = parseMccArgs(argv("rts"));
  const pk = parseMccArgs(argv("packet #110"));
  const ld = parseMccArgs(argv("land 110 --head abc1234"));
  const es = parseMccArgs(argv("escalate 110 -- 운영 상태 형식이 바뀜"));
  const w = parseMccArgs(argv("inspect 110 --head abc1234 --verdict findings -- P1 새 동작에 테스트 없음"));
  if (saved === undefined) delete process.env.ATC_MCC_MODEL;
  else process.env.ATC_MCC_MODEL = saved;
  assert.deepEqual(rts.body, { model: "claude-opus-5-5" });
  assert.deepEqual(pk, { method: "GET", path: "/api/mcc/packet/110" });
  assert.deepEqual(ld, { method: "POST", path: "/api/mcc/land/110", body: { head: "abc1234", model: "claude-opus-5-5" } });
  assert.deepEqual(es, { method: "POST", path: "/api/mcc/escalate/110", body: { reason: "운영 상태 형식이 바뀜", model: "claude-opus-5-5" } });
  assert.deepEqual(w, { method: "POST", path: "/api/mcc/inspect/110", body: { head: "abc1234", verdict: "findings", text: "P1 새 동작에 테스트 없음", model: "claude-opus-5-5" } });
  assert.throws(() => parseMccArgs(argv("merge 110")), /queue\|packet/);
  assert.throws(() => parseMccArgs(argv("queue extra")), /알 수 없는 인자/);
  assert.throws(() => parseMccArgs(argv("packet atc#110")), /PR 번호/);
  assert.throws(() => parseMccArgs(argv("land 110")), /--head/);
  assert.throws(() => parseMccArgs(argv("land 110 --head abc1234 --verdict pass")), /--verdict를 쓰지 않는다/);
  assert.throws(() => parseMccArgs(argv("land 110 --head abc1234 -- 지금")), /-- 글이 없다/);
  assert.throws(() => parseMccArgs(argv("escalate 110")), /사유/);
  assert.throws(() => parseMccArgs(argv("inspect 110 --verdict pass -- ok")), /--head/);
  assert.throws(() => parseMccArgs(argv("inspect 110 --head abc1234 --verdict maybe -- ok")), /pass\|findings/);
  assert.throws(() => parseMccArgs(argv("inspect 110 --head abc1234 --verdict pass")), /INSPECTION 내용/);
  assert.throws(() => parseMccArgs(argv("inspect 110 --head abc1234 --model x -- ok")), /알 수 없는 인자/);
});

test("mcc 응답 한 줄: LAND는 막힌 조건·would·LANDED(flagged면 바뀐 관제 규칙), RTS는 시작·would·안 함", () => {
  assert.equal(mccText("land", { landed: false, blocks: [{ code: "L6", text: "INSPECTION 없음" }, { code: "L4", text: "CI 진행 중" }] }), "LAND 안 함 — L6 INSPECTION 없음 · L4 CI 진행 중");
  assert.equal(mccText("land", { landed: false, would: true, tier: "auto" }), "WOULD LAND (shadow) · auto");
  assert.equal(mccText("land", { landed: true, tier: "flagged", flagged: ["controller/CLAUDE.md"] }), "LANDED · flagged · 바뀐 관제 규칙: controller/CLAUDE.md");
  assert.equal(mccText("rts", { started: false, why: "서비스가 최신" }), "RTS 안 함 — 서비스가 최신");
  assert.equal(mccText("rts", { started: false, would: true, why: "a → b" }), "WOULD RTS · a → b");
  assert.equal(
    mccText("inspect", { inspection: { pr: 110, verdict: "findings", head: "abcdef1234", p0: 0, p1: 1, p2: 0, model: "claude-opus-5-5", comment: "posted" } }),
    "#110 INSPECTION findings · head abcdef1 · P0 0 · P1 1 · P2 0 (claude-opus-5-5) · PR 댓글 남김",
  );
});

test("manual check: OCC 절차 파일까지 해시한다, 번역(*.en.md)은 뺀다(ATC-9)", () => {
  const OCC = new URL("../occ", import.meta.url).pathname;
  const files = manualFiles(OCC);
  assert.deepEqual(files.slice(0, 2), ["CLAUDE.md", ".claude/skills/tick/SKILL.md"]);
  for (const f of ["briefing", "crew-change", "flight-plan", "following", "schedule"]) assert.ok(files.includes(`.claude/skills/tick/${f}.md`), f);
  assert.ok(files.every((f) => !f.endsWith(".en.md")));
  // 절차 파일마다 영어판이 있고, CLAUDE.md의 "절차 파일" 표와 /tick이 그 파일을 가리킨다.
  const core = readFileSync(join(OCC, "CLAUDE.md"), "utf8");
  const tick = readFileSync(join(OCC, ".claude/skills/tick/SKILL.md"), "utf8");
  for (const f of files.slice(2)) {
    const name = f.split("/").pop();
    assert.ok(existsSync(join(OCC, f.replace(/\.md$/, ".en.md"))), `${name} 영어판`);
    assert.ok(core.includes(`(${f})`), `CLAUDE.md 표에 ${name}`);
    assert.ok(tick.includes(name), `/tick에 ${name}`);
  }
});

test("manual check: 절차 파일이 바뀌면 CHANGED, 번역만 바뀌면 그대로. 절차 파일 없는 폴더는 전과 같은 해시", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-manual-"));
  try {
    mkdirSync(join(dir, ".claude/skills/tick"), { recursive: true });
    writeFileSync(join(dir, "CLAUDE.md"), "핵심");
    writeFileSync(join(dir, ".claude/skills/tick/SKILL.md"), "tick");
    // 예전 방식(CLAUDE.md와 SKILL.md 두 파일)과 같은 값: TOWER·CROSSCHECK는 배포 뒤에도 CHANGED가 뜨지 않는다.
    const old = createHash("sha256");
    for (const f of ["CLAUDE.md", ".claude/skills/tick/SKILL.md"]) old.update(`${f}\0`).update(readFileSync(join(dir, f)));
    assert.equal(manualHash(dir), old.digest("hex"));

    writeFileSync(join(dir, ".claude/skills/tick/schedule.md"), "초안 v1");
    const v1 = manualHash(dir);
    writeFileSync(join(dir, ".claude/skills/tick/schedule.en.md"), "drafts v1");
    writeFileSync(join(dir, ".claude/skills/tick/SKILL.en.md"), "tick en");
    assert.equal(manualHash(dir), v1);
    writeFileSync(join(dir, ".claude/skills/tick/schedule.md"), "초안 v2");
    assert.notEqual(manualHash(dir), v1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("schedule draft TARGET·ROUTE(ATC-25): AIRCRAFT와 옵션, 근거", () => {
  assert.deepEqual(parseDraft(argv("target team_i --flights-per-week 5 --on-time none -- 14일 5건")), {
    kind: "TARGET", registration: "TEAM_I", flightsPerWeek: "5", onTime: "none", reason: "14일 5건",
  });
  assert.deepEqual(parseDraft(["ROUTE", "TEAM_C", "--add", "Beta Readiness", "--add", "Song Catalog", "--remove", "Home & Discovery", "--", "완료된", "ROUTE"]), {
    kind: "ROUTE", registration: "TEAM_C", add: ["Beta Readiness", "Song Catalog"], remove: ["Home & Discovery"], reason: "완료된 ROUTE",
  });
  assert.throws(() => parseDraft(argv("TARGET -- x")), /REGISTRATION/);
  assert.throws(() => parseDraft(argv("TARGET TEAM_I -- x")), /--flights-per-week이나 --on-time/);
  assert.throws(() => parseDraft(argv("TARGET TEAM_I --add X -- x")), /쓸 수 없는 옵션/);
  assert.throws(() => parseDraft(argv("TARGET TEAM_I --on-time 0.9 --on-time 0.8 -- x")), /한 번만/);
  assert.throws(() => parseDraft(argv("ROUTE TEAM_I --add X")), /근거/);
  assert.equal(
    draftText({ id: "S-0009", kind: "TARGET", flight: null, payload: { registration: "TEAM_I", flightsPerWeek: 5, from: { flightsPerWeek: 3, onTime: 0.8 } } }),
    "S-0009 TARGET TEAM_I 초안 · flightsPerWeek 3 → 5 (그림자 판정만, FLEET에 쓰지 않음)",
  );
  assert.equal(payloadText({ kind: "ROUTE", payload: { registration: "TEAM_C", add: ["A"], remove: ["B"] } }), "+ A · − B");
});
