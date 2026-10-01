import assert from "node:assert/strict";
import { test } from "node:test";
import { GRACE_MS, matchNamed, type Named, OPEN_WINDOW_MS, openedRate, outcomeOf, scanTranscript, type SessionCalls, usageOf } from "./skill-calls.ts";

// 작은 가짜 대화 기록(실제 ~/.claude* 폴더는 읽지 않는다)
const asst = (at: string, ...blocks: object[]) => JSON.stringify({ type: "assistant", timestamp: at, isSidechain: false, message: { role: "assistant", content: blocks } });
const tool = (name: string, input: object) => ({ type: "tool_use", id: "t1", name, input });
const human = (at: string, content: unknown = "hello") => JSON.stringify({ type: "user", timestamp: at, message: { role: "user", content } });
const result = (at: string) => JSON.stringify({ type: "user", timestamp: at, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "SECRET-RESULT" }] } });

test("scanTranscript: Skill·네임스페이스 Skill·sub-agent 호출은 이름과 시각만, 본문과 인자는 남지 않는다", () => {
  const text = [
    JSON.stringify({ type: "agent-name", agentName: "TEAM_J", sessionId: "s1" }),
    asst("2026-10-01T01:00:00.000Z", { type: "text", text: "SECRET-TEXT" }, tool("Skill", { skill: "atc-task", args: "SECRET-ARGS" })),
    asst("2026-10-01T01:01:00.000Z", tool("Skill", { skill: "atc-rulebook:qrh-04-go-around" })),
    asst("2026-10-01T01:02:00.000Z", tool("Agent", { subagent_type: "Explore", prompt: "SECRET-PROMPT" })),
    asst("2026-10-01T01:03:00.000Z", tool("Task", { subagent_type: "Plan", prompt: "x" })),
    asst("2026-10-01T01:04:00.000Z", tool("Bash", { command: "ls" })),
    JSON.stringify({ type: "assistant", timestamp: "2026-10-01T01:05:00.000Z", isSidechain: true, message: { content: [tool("Skill", { skill: "side" })] } }),
    "not json with \"type\":\"assistant\" and \"tool_use\" and \"name\":\"Skill\"",
  ].join("\n");
  const st = scanTranscript(text);
  assert.equal(st.reg, "TEAM_J");
  assert.deepEqual(st.calls, [
    { at: "2026-10-01T01:00:00.000Z", kind: "skill", name: "atc-task" },
    { at: "2026-10-01T01:01:00.000Z", kind: "skill", name: "atc-rulebook:qrh-04-go-around" },
    { at: "2026-10-01T01:02:00.000Z", kind: "agent", name: "Explore" },
    { at: "2026-10-01T01:03:00.000Z", kind: "agent", name: "Plan" },
  ]);
  assert.equal(JSON.stringify(st).includes("SECRET"), false);
});

test("scanTranscript: 사용자 차례는 사람·세션 메시지만(도구 결과·isMeta·sidechain 제외)", () => {
  const text = [
    human("2026-10-01T02:00:00.000Z"),
    result("2026-10-01T02:00:05.000Z"),
    JSON.stringify({ type: "user", timestamp: "2026-10-01T02:00:06.000Z", isMeta: true, message: { content: "Base directory for this skill" } }),
    JSON.stringify({ type: "user", timestamp: "2026-10-01T02:00:07.000Z", isSidechain: true, message: { content: "x" } }),
    human("2026-10-01T02:01:00.000Z", [{ type: "text", text: "second" }]),
  ].join("\n");
  assert.deepEqual(scanTranscript(text).turns, ["2026-10-01T02:00:00.000Z", "2026-10-01T02:01:00.000Z"]);
});

const S = (reg: string, calls: [string, string][], turns: string[] = [], extra: Partial<SessionCalls> = {}): SessionCalls => ({
  session: `id-${reg}`,
  reg,
  role: null,
  calls: calls.map(([at, name]) => ({ at, kind: "skill" as const, name })),
  turns,
  ...extra,
});

test("usageOf: 창 안의 호출을 이름·세션별로 세고, 창 밖은 뺀다", () => {
  const a = S("Team J", [["2026-10-01T01:00:00.000Z", "atc-task"], ["2026-10-01T01:01:00.000Z", "atc-task"], ["2026-09-30T23:59:59.000Z", "old"]]);
  a.calls.push({ at: "2026-10-01T03:00:00.000Z", kind: "agent", name: "Explore" });
  const b = S("x", [], [], { reg: null, role: "tower", calls: [{ at: "2026-10-01T04:00:00.000Z", kind: "skill", name: "p:qrh-01-lost-comms" }] });
  const u = usageOf([a, b, S("TEAM_K", [])], "2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z");
  assert.deepEqual(u.skills, { "atc-task": 2, "p:qrh-01-lost-comms": 1 });
  assert.deepEqual(u.agents, { Explore: 1 });
  assert.deepEqual(u.bySession, { TEAM_J: { skills: 2, agents: 1 }, TOWER: { skills: 1, agents: 0 } });
  assert.equal(u.sessions, 2);
});

const T0 = "2026-10-01T05:00:00.000Z";
const at = (sec: number) => new Date(Date.parse(T0) + sec * 1000).toISOString();
const named = (extra: Partial<Named> = {}): Named => ({ t: T0, id: "qrh-04-go-around", aircraft: "TEAM_G", subject: "C-0123", ...extra });

test("outcomeOf: 올바른 skill(이름공간 있어도)을 같은 차례에 열면 opened", () => {
  assert.equal(outcomeOf(named(), [S("TEAM_G", [[at(20), "atc-rulebook:qrh-04-go-around"]])]), "opened");
  assert.equal(outcomeOf(named(), [S("TEAM_G", [[at(20), "qrh-04-go-around"]])]), "opened");
});

test("outcomeOf: 다른 qrh-*를 열면 opened-other, 아무것도 안 열면(또는 qrh가 아닌 skill만) not-opened", () => {
  assert.equal(outcomeOf(named(), [S("TEAM_G", [[at(20), "atc-rulebook:qrh-02-stalled"]])]), "opened-other");
  assert.equal(outcomeOf(named(), [S("TEAM_G", [])]), "not-opened");
  assert.equal(outcomeOf(named(), [S("TEAM_G", [[at(20), "atc-task"]])]), "not-opened");
  // 올바른 것이 다른 것보다 늦어도 opened
  assert.equal(outcomeOf(named(), [S("TEAM_G", [[at(20), "qrh-02-stalled"], [at(40), "qrh-04-go-around"]])]), "opened");
});

test("outcomeOf: 창 — 이름 붙이기 전 호출·다음 사용자 차례 뒤·N분 뒤 호출은 세지 않고, 이름을 나른 차례(GRACE 안)는 넘긴다", () => {
  assert.equal(outcomeOf(named(), [S("TEAM_G", [[at(-5), "qrh-04-go-around"]])]), "not-opened");
  // 이름을 나른 차례(t+5s)는 경계가 아니다
  assert.equal(outcomeOf(named(), [S("TEAM_G", [[at(30), "qrh-04-go-around"]], [at(5)])]), "opened");
  // t+GRACE 뒤에 시작한 다음 차례가 경계
  const nextTurn = GRACE_MS / 1000 + 10;
  assert.equal(outcomeOf(named(), [S("TEAM_G", [[at(nextTurn + 30), "qrh-04-go-around"]], [at(5), at(nextTurn)])]), "not-opened");
  assert.equal(outcomeOf(named(), [S("TEAM_G", [[at(nextTurn - 5), "qrh-04-go-around"]], [at(5), at(nextTurn)])]), "opened");
  assert.equal(outcomeOf(named(), [S("TEAM_G", [[at(OPEN_WINDOW_MS / 1000 + 1), "qrh-04-go-around"]])]), "not-opened");
});

test("outcomeOf: 세션은 sessionId, 등록 표기(Team G), 관제 역할로 찾고, 없으면 no-transcript", () => {
  const calls: [string, string][] = [[at(20), "qrh-04-go-around"]];
  assert.equal(outcomeOf(named({ aircraft: undefined, session: "id-TEAM_G" }), [S("TEAM_G", calls)]), "opened");
  assert.equal(outcomeOf(named({ aircraft: "TEAM_G" }), [S("Team G", calls)]), "opened");
  assert.equal(outcomeOf(named({ aircraft: undefined, session: "TOWER" }), [S("x", calls, [], { reg: null, role: "tower" })]), "opened");
  assert.equal(outcomeOf(named(), [S("TEAM_H", calls)]), "no-transcript");
  assert.equal(outcomeOf(named({ aircraft: undefined }), [S("TEAM_G", calls)]), "no-transcript");
  assert.equal(outcomeOf(named({ t: "bad" }), [S("TEAM_G", calls)]), "no-transcript");
});

test("matchNamed: opened / opened-other / not-opened 세기와 비율(분모 0이면 null, no-transcript는 분모에서 뺀다)", () => {
  const sessions = [S("TEAM_G", [[at(20), "qrh-04-go-around"]]), S("TEAM_H", [[at(20), "qrh-02-stalled"]]), S("TEAM_I", [])];
  const c = matchNamed([named(), named({ aircraft: "TEAM_H" }), named({ aircraft: "TEAM_I" }), named({ aircraft: "TEAM_Z" })], sessions);
  assert.deepEqual(c, { named: 4, opened: 1, openedOther: 1, notOpened: 1, noTranscript: 1 });
  assert.equal(openedRate(c), 1 / 3);
  const none = matchNamed([], sessions);
  assert.deepEqual(none, { named: 0, opened: 0, openedOther: 0, notOpened: 0, noTranscript: 0 });
  assert.equal(openedRate(none), null);
});
