import assert from "node:assert/strict";
import { test } from "node:test";
import { supervisorAlertsOf } from "./supervisor-alerts.ts";
import { flightWords, kindOf, PHRASE_CHARS, PHRASE_MAX, phraseOf, whoWords } from "./voice-phrase.ts";

// 음성 콜아웃 문구(ATC-140): 알림 종류마다 고정 틀, 한국어 text는 읽지 않는다
const a = (key: string, aircraft: string | null = null, flight: string | null = null) => ({ key, aircraft, flight });

test("FLIGHT 번호는 한 자리씩 읽고 9는 niner", () => {
  assert.equal(flightWords("ATC-120"), "ATC one two zero");
  assert.equal(flightWords("VOC-199"), "VOC one niner niner");
  assert.equal(flightWords("atc-9"), "ATC niner");
  assert.equal(flightWords("ATC-1234567"), null); // 6자리를 넘는 번호는 읽지 않는다
  assert.equal(flightWords("AD HOC"), null);
  assert.equal(flightWords(null), null);
});

test("콜사인은 callsign()에서: TEAM_G → GOLF, 여럿은 and로", () => {
  assert.equal(whoWords("TEAM_G"), "GOLF");
  assert.equal(whoWords("TEAM_G, TEAM_K"), "GOLF and KILO");
  assert.equal(whoWords("TEAM_A, TEAM_B, TEAM_C"), "ALPHA, BRAVO and CHARLIE");
  assert.equal(whoWords(null), "");
  assert.equal(whoWords("TOWER"), "TOWER"); // 팀 이름이 아니면 이름 그대로
  assert.equal(whoWords("팀<script>"), "script"); // 허용하지 않는 글자는 빠진다
});

test("종류는 key에서 읽는다", () => {
  assert.equal(kindOf({ key: "alert|conflict|/w/a|ATC-1|s1,s2" }), "conflict");
  assert.equal(kindOf({ key: "alert|health|STALLED|s1" }), "health:STALLED");
  assert.equal(kindOf({ key: "pending|proposal|D-0001" }), "pending:proposal");
  assert.equal(kindOf({ key: "rts|2026-09-29T08:00:00Z|rollback" }), "rts:rollback");
  assert.equal(kindOf({ key: "land|o/r#1|abc" }), null);
  assert.equal(kindOf({ key: "following|ATC-1|no-pr" }), null);
});

test("WARNING의 모든 종류: conflict · stranded · RTS rollback · RTS failed", () => {
  assert.equal(phraseOf(a("alert|conflict|/w/a|ATC-120|s1,s2", "TEAM_G, TEAM_K", "ATC-120")), "Supervisor, GOLF and KILO, traffic conflict on ATC one two zero, request instructions.");
  assert.equal(phraseOf(a("alert|conflict|/w/a||s1", null, null)), "Supervisor, traffic conflict, request instructions.");
  assert.equal(phraseOf(a("alert|stranded|/w/a|ATC-121|", null, "ATC-121")), "Supervisor, ATC one two one stranded, merge not on main, request instructions.");
  assert.equal(phraseOf(a("alert|stranded||", null, null)), "Supervisor, merge stranded, merge not on main, request instructions.");
  assert.equal(phraseOf(a("rts|2026-09-29T08:00:00Z|rollback")), "Supervisor, return to service rolled back, request instructions.");
  assert.equal(phraseOf(a("rts|2026-09-29T08:00:00Z|failed")), "Supervisor, return to service failed, request instructions.");
});

test("CALL의 모든 종류: 도구 승인 · DISPATCH 제안 · HUMAN CHECK", () => {
  assert.equal(phraseOf(a("pending|tool|s1|2026-09-29T08:00:00Z", "TEAM_G")), "Supervisor, GOLF, standing by for approval.");
  assert.equal(phraseOf(a("pending|proposal|D-0123", "TEAM_K", "ATC-140")), "Supervisor, dispatch proposal waiting on ATC one four zero, request decision.");
  assert.equal(phraseOf(a("pending|proposal|D-0123", "TEAM_K", null)), "Supervisor, dispatch proposal waiting, request decision.");
  assert.equal(phraseOf(a("pending|humancheck|o/r#5|abc", null, "ATC-5")), "Supervisor, human check waiting on ATC five, request decision.");
});

test("예시 문구: STALLED(지금은 CAUTION이라 소리 나지 않지만 틀은 있다)", () => {
  assert.equal(phraseOf(a("alert|health|STALLED|s1", "TEAM_G", "ATC-120")), "Supervisor, GOLF, stalled on ATC one two zero, request instructions.");
});

test("틀이 없는 종류는 null: 그 알림은 소리만 난다", () => {
  for (const key of ["alert|health|LIMIT|acct", "alert|orphan|/w/x||", "alert|no-workspace|/w/x||", "following|ATC-1|no-pr", "land|o/r#1|abc", "rts|2026-09-29T08:00:00Z|ok", "rts|2026-09-29T08:00:00Z|refused", "weird", ""]) {
    assert.equal(phraseOf(a(key, "TEAM_G", "ATC-1")), null, key);
  }
});

test("글자는 [A-Za-z0-9 ,.'-]만이고, 한국어 text·제목은 읽지 않으며, 길이를 넘기지 않는다", () => {
  const hostile = phraseOf(a("alert|conflict|x|y|z", "TEAM_G; rm -rf /, <b>TEAM_K</b>\n\"quoted\"", "ATC-1"))!;
  assert.equal(PHRASE_CHARS.test(hostile), false);
  PHRASE_CHARS.lastIndex = 0;
  assert.match(hostile, /^[A-Za-z0-9 ,.'-]+$/);
  assert.ok(hostile.length <= PHRASE_MAX);
  const long = phraseOf(a("alert|conflict|x", Array.from({ length: 80 }, () => "TEAM_G").join(", "), "ATC-1"))!;
  assert.ok(long.length <= PHRASE_MAX);
  // supervisorAlertsOf가 만든 실제 항목: text의 한국어는 문구에 들어가지 않는다
  const items = supervisorAlertsOf({
    sessions: [{ id: "s1", name: "TEAM_G", status: "idle", health: { code: "PENDING", level: "info", since: "2026-09-29T08:00:00Z", detail: "Bash 승인 대기", next: "승인한다", holds: false } as never }],
    alerts: [{ kind: "conflict", message: "충돌: 같은 STAND를 두 팀이 점유", workspacePath: "/w/atc-120", sessionIds: ["s1"], ticketKey: "ATC-120" }],
    workspaces: [{ path: "/w/atc-120", ticketKey: "ATC-120" }],
    tickets: [],
    following: [],
    proposals: [{ id: "D-0009", kind: "ASSIGN", status: "proposed", flight: "ATC-150", aircraftName: "TEAM_K", holdAt: null, statusAt: "2026-09-29T08:00:00Z" }],
    pulls: [],
    rts: { at: "2026-09-29T09:00:00Z", from: "aaaaaaa", to: "bbbbbbb", result: "rollback", detail: "상태 확인 실패" },
  });
  const phrases = items.map((i) => [i.cue ?? i.level, phraseOf(i)]);
  assert.deepEqual(
    phrases.sort((x, y) => String(x[1]).localeCompare(String(y[1]))),
    [
      ["warning", "Supervisor, GOLF, traffic conflict on ATC one two zero, request instructions."],
      ["warning", "Supervisor, return to service rolled back, request instructions."],
      ["call", "Supervisor, GOLF, standing by for approval."],
      ["call", "Supervisor, dispatch requests ATC one five zero for KILO, request decision."],
    ].sort((x, y) => x[1].localeCompare(y[1])),
  );
  for (const [, p] of phrases) assert.doesNotMatch(String(p), /[가-힣]/);
});

test("DISPATCH 문구는 무엇을 청하는지 말한다(ATC-162): ASSIGN은 AIRCRAFT에, RELEASE는 그 FLIGHT를 풀어 달라고", () => {
  const p = (ask: string | undefined, who: string | null, flight: string | null) => phraseOf({ key: "pending|proposal|D-0001", aircraft: who, flight, ...(ask ? { ask } : {}) });
  assert.equal(p("assign", "TEAM_H", "ATC-146"), "Supervisor, dispatch requests ATC one four six for HOTEL, request decision.");
  assert.equal(p("release", null, "ATC-146"), "Supervisor, dispatch requests release of ATC one four six, request decision.");
  assert.equal(p("assign", null, "ATC-146"), "Supervisor, dispatch requests ATC one four six, request decision.");
  assert.equal(p("release", null, null), "Supervisor, dispatch requests release, request decision.");
  // ask가 없는 옛 항목은 예전 문구 그대로
  assert.equal(p(undefined, "TEAM_H", "ATC-146"), "Supervisor, dispatch proposal waiting on ATC one four six, request decision.");
});

test("SCHEDULE 문구(ATC-162): 종류와 FLIGHT. NEW는 FLIGHT가 아직 없다", () => {
  const s = (ask: string, flight: string | null) => phraseOf({ key: "pending|schedule|S-0001", aircraft: null, flight, ask });
  assert.equal(s("tail", "ATC-146"), "Supervisor, schedule requests tail on ATC one four six, request decision.");
  assert.equal(s("new", null), "Supervisor, schedule requests a new flight, request decision.");
  assert.equal(phraseOf({ key: "pending|schedule|S-0001", aircraft: null, flight: null }), "Supervisor, schedule requests an update, request decision.");
  assert.equal(kindOf({ key: "pending|schedule|S-0001" }), "pending:schedule");
});

test("새 문구도 같은 글자 집합과 길이 한도(PHRASE_CHARS, PHRASE_MAX)를 지킨다", () => {
  const hostile = [
    phraseOf({ key: "pending|proposal|D-1", aircraft: "TEAM_G; <b>x</b>, TEAM_K\n\"q\"", flight: "ATC-1", ask: "assign" }),
    phraseOf({ key: "pending|schedule|S-1", aircraft: null, flight: "ATC-1", ask: "ta;il <script>\n" + "x".repeat(400) }),
  ];
  for (const h of hostile) {
    assert.ok(h);
    assert.match(h!, /^[A-Za-z0-9 ,.'-]+$/);
    assert.ok(h!.length <= PHRASE_MAX);
  }
});
