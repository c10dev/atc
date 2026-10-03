import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type FileChange, isRemovalEscalation, removalEscalationsOf, removalPacketOf, removalStatsOf, removedLineOf } from "./removal-rule.ts";

// 실제 자료(공개 저장소 c10dev/atc): PR 515(ATC-423)의 본문과, 커밋 6d7d2a0(ATC-456)·PR 515의 파일 목록
const BODY_515 = readFileSync(new URL("./fixtures/pr-515-body.md", import.meta.url), "utf8");
const FILES = JSON.parse(readFileSync(new URL("./fixtures/removal-files.json", import.meta.url), "utf8")) as { commit6d7d2a0: FileChange[]; pr515: FileChange[] };

test("Removed: 줄 읽기: 없음, none, 목록, 두 줄, 아래 목록", () => {
  assert.deepEqual(removedLineOf("## Summary\n- a\n"), { state: "absent" });
  assert.deepEqual(removedLineOf("x\nRemoved: none\ny"), { state: "none" });
  assert.deepEqual(removedLineOf("Removed: None."), { state: "none" });
  assert.deepEqual(removedLineOf("Removed: RELEASE group tree (not named in the order); the READY list in the sidebar"), { state: "list", items: ["RELEASE group tree (not named in the order)", "the READY list in the sidebar"] });
  assert.deepEqual(removedLineOf("Removed: the tree — line 3 of the work order asks for it\nRemoved: ReleaseTree.css, only the tree used it"), { state: "list", items: ["the tree — line 3 of the work order asks for it", "ReleaseTree.css, only the tree used it"] });
  assert.deepEqual(removedLineOf("**Removed:** none"), { state: "none" });
  assert.deepEqual(removedLineOf("- Removed:\n  - the READY list\n  - the badge\n\nnext"), { state: "list", items: ["the READY list", "the badge"] });
  assert.deepEqual(removedLineOf("Removed:\n\nnothing here"), { state: "absent" }); // 비어 있는 줄은 없는 것과 같다
  assert.deepEqual(removedLineOf("Removed lines (7): constant lines"), { state: "absent" }); // 비슷한 글은 줄이 아니다
});

test("PR 515의 본문에는 Removed: 줄이 없다(P1 사례)", () => {
  assert.deepEqual(removedLineOf(BODY_515), { state: "absent" });
});

test("파일 목록: 6d7d2a0은 ReleaseTree.css를 더했고 PR 515는 그것을 지운다", () => {
  assert.ok(FILES.commit6d7d2a0.some((f) => f.filename === "web/src/views/ReleaseTree.css" && f.status === "added"));
  const p = removalPacketOf({ rule: "on", body: BODY_515, files: FILES.pr515, workOrderText: "## Goal\nRELEASE rows" });
  assert.deepEqual(p.deletedFiles, ["web/src/views/ReleaseTree.css"]);
  assert.deepEqual(p.deletedUiFiles, ["web/src/views/ReleaseTree.css"]);
  assert.deepEqual(p.hints, ["missing-removed-line", "none-but-deleted-ui-files"]);
  assert.equal(p.workOrder, "present");
  // 6d7d2a0은 아무것도 지우지 않는다
  assert.deepEqual(removalPacketOf({ rule: "on", body: "Removed: none", files: FILES.commit6d7d2a0, workOrderText: "x" }).hints, []);
});

test("목록이 있는 Removed: 줄은 지운 파일이 있어도 단서가 없다(이름 붙였다)", () => {
  const p = removalPacketOf({ rule: "on", body: "Removed: the group tree (ReleaseTree.css), line 4 of the order", files: FILES.pr515, workOrderText: "x" });
  assert.deepEqual(p.hints, []);
});

test("Removed: none인데 화면 파일이 지워지면 단서, 문서·테스트만 지워지면 단서 없음", () => {
  const docsOnly: FileChange[] = [{ filename: "docs/old.md", status: "removed" }, { filename: "server/x.test.ts", status: "removed" }];
  assert.deepEqual(removalPacketOf({ rule: "on", body: "Removed: none", files: docsOnly, workOrderText: "x" }).hints, []);
  assert.deepEqual(removalPacketOf({ rule: "on", body: "Removed: none", files: FILES.pr515, workOrderText: "x" }).hints, ["none-but-deleted-ui-files"]);
});

test("스위치 off: 규칙이 꺼졌다고 말하고 단서는 비운다. 사실은 그대로 준다", () => {
  const p = removalPacketOf({ rule: "off", body: BODY_515, files: FILES.pr515, workOrderText: "x" });
  assert.equal(p.rule, "off");
  assert.match(p.note, /OFF/);
  assert.deepEqual(p.hints, []);
  assert.deepEqual(p.deletedFiles, ["web/src/views/ReleaseTree.css"]);
  assert.match(removalPacketOf({ rule: "on", body: "", files: [], workOrderText: "x" }).note, /ON/);
});

test("작업 지시서 글이 패킷에 없으면 workOrder: missing", () => {
  assert.equal(removalPacketOf({ rule: "on", body: "", files: [], workOrderText: null }).workOrder, "missing");
  assert.equal(removalPacketOf({ rule: "on", body: "", files: [], workOrderText: "  \n" }).workOrder, "missing");
});

test("지우기 ESCALATE 문구", () => {
  assert.ok(isRemovalEscalation("removes the RELEASE group tree, not named in the work order"));
  assert.ok(!isRemovalEscalation("changes an operating-state format"));
  assert.ok(!isRemovalEscalation("seems to go beyond the FLIGHT"));
});

const rec = (pr: number, head: string, at: string, reason = "removes the group tree, not named in the work order") => ({ op: "escalate", pr, head, at, reason });
const NOW = Date.parse("2030-01-10T00:00:00Z");

test("지우기 ESCALATE만 세고 같은 PR·head는 하나", () => {
  const e = removalEscalationsOf([rec(1, "aaa", "2030-01-09T00:00:00Z"), rec(1, "aaa", "2030-01-09T01:00:00Z"), { op: "escalate", pr: 2, head: "bbb", at: "2030-01-09T00:00:00Z", reason: "state format" }, { op: "inspect", pr: 1, head: "aaa", at: "x" }]);
  assert.deepEqual(e, [{ pr: 1, head: "aaa", at: "2030-01-09T00:00:00Z" }]);
});

test("오작동: 같은 head 그대로 SUPERVISOR가 착륙. head가 바뀐 뒤 머지, MCC 착륙, 머지 전, 7일 밖은 아니다. 총수는 늘 보인다", () => {
  const esc = removalEscalationsOf([
    rec(1, "aaaaaaa", "2030-01-09T00:00:00Z"), // 같은 head로 머지 → 오작동
    rec(2, "bbbbbbb", "2030-01-09T00:00:00Z"), // head가 바뀐 뒤 머지 → 아님
    rec(3, "ccccccc", "2030-01-09T00:00:00Z"), // 아직 머지 전
    rec(4, "ddddddd", "2030-01-09T00:00:00Z"), // MCC가 착륙시킴
    rec(5, "eeeeeee", "2029-12-20T00:00:00Z"), // 7일 밖: 총수에만
  ]);
  const merged = new Map([[1, "aaaaaaa1111"], [2, "zzzzzzz"], [4, "ddddddd"], [5, "eeeeeee"]]);
  const s = removalStatsOf(esc, merged, new Set(["4@ddddddd"]), NOW);
  assert.deepEqual(s, { total: 5, last7d: 4, misfires: 1, changed: 1, waiting: 1, landedByMcc: 1 });
});

test("오작동 수는 0이어도 총수가 따로 있어 '한 번도 안 울렸다'와 구별된다", () => {
  const s = removalStatsOf(removalEscalationsOf([rec(1, "aaa", "2030-01-09T00:00:00Z")]), new Map([[1, "different"]]), new Set(), NOW);
  assert.equal(s.misfires, 0);
  assert.equal(s.total, 1);
  assert.equal(removalStatsOf([], new Map(), new Set(), NOW).total, 0);
});
