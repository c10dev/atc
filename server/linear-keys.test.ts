import assert from "node:assert/strict";
import { test } from "node:test";
import { keyInName, keyInTitle, parseTeamKeys, teamOfKey } from "./linear-keys.ts";
import { mergeColumns } from "./sources/linear.ts";

test("읽는 팀: 주 팀이 맨 앞, 목록은 쉼표·공백 구분, 틀린 key는 버리고 중복은 한 번", () => {
  assert.deepEqual(parseTeamKeys("VOC", undefined), ["VOC"]); // 기존 설정 그대로
  assert.deepEqual(parseTeamKeys("VOC", "VOC,ATC"), ["VOC", "ATC"]);
  assert.deepEqual(parseTeamKeys("voc", " atc , voc 1x A2B q"), ["VOC", "ATC", "A2B"]); // 1x(숫자로 시작)·q(1자)는 버림
  assert.deepEqual(parseTeamKeys("VOC", "ATC,VOC"), ["VOC", "ATC"]); // 주 팀은 목록 순서와 상관없이 맨 앞
  assert.deepEqual(parseTeamKeys("1X", "ATC"), ["ATC"]);
  assert.deepEqual(parseTeamKeys(undefined, ""), ["VOC"]);
  assert.equal(teamOfKey("ATC-12"), "ATC");
});

test("브랜치·워크트리 이름의 key: 읽는 팀 모두, 경계가 있어야 하고 번호의 0은 떨어진다", () => {
  const keys = ["VOC", "ATC"];
  assert.equal(keyInName("claude/voc-123-fix", keys), "VOC-123");
  assert.equal(keyInName("claude/atc-1-linear-teams", keys), "ATC-1");
  assert.equal(keyInName("vocado-VOC007", keys), "VOC-7");
  assert.equal(keyInName("/home/c10/projects/worktrees/atc-12", keys), "ATC-12");
  // atc 저장소의 흔한 워크트리 이름은 key가 아니다
  assert.equal(keyInName("atc-doc-fixes", keys), null);
  assert.equal(keyInName("atc-2b-readiness", keys), null);
  assert.equal(keyInName("claude/pre-gate-fixes", keys), null);
  assert.equal(keyInName("matc-12", keys), null); // 앞 경계 없음
  assert.equal(keyInName("claude/abc-5", keys), null); // 읽지 않는 팀
  assert.equal(keyInName(null, keys), null);
});

test("PR 제목 끝의 (KEY-n): 읽는 팀만", () => {
  assert.equal(keyInTitle("Read several Linear teams (ATC-1)", ["VOC", "ATC"]), "ATC-1");
  assert.equal(keyInTitle("Fix (voc-07) ", ["VOC", "ATC"]), "VOC-7");
  assert.equal(keyInTitle("Other team (ABC-1)", ["VOC", "ATC"]), null);
  assert.equal(keyInTitle("Mentions (ATC-1) in the middle", ["ATC"]), null);
});

test("상태 목록 합치기: 이름이 같으면 먼저 읽은(주) 팀의 것, 순서는 종류 → 위치", () => {
  const voc = [
    { name: "Todo", type: "unstarted", color: "#1", position: 1 },
    { name: "Done", type: "completed", color: "#2", position: 5 },
    { name: "In Progress", type: "started", color: "#3", position: 2 },
  ];
  const atc = [
    { name: "Todo", type: "unstarted", color: "#9", position: 0 },
    { name: "Backlog", type: "backlog", color: "#8", position: 0 },
  ];
  assert.deepEqual(mergeColumns([voc, atc]), [
    { name: "Backlog", type: "backlog", color: "#8" },
    { name: "Todo", type: "unstarted", color: "#1" },
    { name: "In Progress", type: "started", color: "#3" },
    { name: "Done", type: "completed", color: "#2" },
  ]);
});
