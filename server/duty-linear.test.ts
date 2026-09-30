import assert from "node:assert/strict";
import { test } from "node:test";
import { issueVerdict, parseLinearBody, resolveLabels, stateVerdict } from "./duty-linear.ts";

const ok = (raw: unknown) => {
  const p = parseLinearBody(raw);
  assert.equal(p.ok, true, JSON.stringify(p));
  return p.ok ? p.op : (undefined as never);
};
const err = (raw: unknown) => {
  const p = parseLinearBody(raw);
  assert.equal(p.ok, false, JSON.stringify(raw));
  return p.ok ? "" : p.error;
};

test("create: title·body·priority가 필요하고 state는 Backlog(기본)·Todo만", () => {
  assert.deepEqual(ok({ action: "create", title: " T ", body: "# B\n\nx", priority: 2 }), { action: "create", title: "T", body: "# B\n\nx", priority: 2, state: "Backlog", labels: [] });
  const full = ok({ action: "create", title: "T", body: "B", priority: 1, state: "Todo", parent: "atc-192", project: "DUTY", labels: ["rating:SEC", "wake:J"] });
  assert.deepEqual(full, { action: "create", title: "T", body: "B", priority: 1, state: "Todo", parent: "ATC-192", project: "DUTY", labels: ["rating:SEC", "wake:J"] });
  assert.match(err({ action: "create", body: "B", priority: 2 }), /title/);
  assert.match(err({ action: "create", title: "T", priority: 2 }), /body/);
  assert.match(err({ action: "create", title: "T", body: "B" }), /priority/);
  for (const p of [0, 5, -1, 1.5, "2", null]) assert.match(err({ action: "create", title: "T", body: "B", priority: p }), /priority/, String(p));
  for (const s of ["Started", "In Progress", "Done", "Canceled", "In Review", "todo", "", 5]) assert.match(err({ action: "create", title: "T", body: "B", priority: 2, state: s }), /state/, String(s));
});

test("create: 알 수 없는 칸·잘못된 parent·project·labels·제어 문자·길이", () => {
  assert.match(err({ action: "create", title: "T", body: "B", priority: 2, assignee: "x" }), /알 수 없는 칸: assignee/);
  assert.match(err({ action: "create", title: "T", body: "B", priority: 2, teamId: "x" }), /알 수 없는 칸/);
  assert.match(err({ action: "create", title: "T", body: "B", priority: 2, team: "VOC" }), /알 수 없는 칸/);
  for (const p of ["VOC-1", "ATC-", "ATC-x", "ATC-1; x", "1", ""]) assert.match(err({ action: "create", title: "T", body: "B", priority: 2, parent: p }), /parent/, p);
  for (const l of ["x", [5], ["a;b"], ["a\nb"], [""], Array.from({ length: 13 }, (_, i) => `l${i}`)]) assert.match(err({ action: "create", title: "T", body: "B", priority: 2, labels: l }), /labels/);
  assert.match(err({ action: "create", title: "a\u0000b", body: "B", priority: 2 }), /title/);
  assert.match(err({ action: "create", title: "x".repeat(201), body: "B", priority: 2 }), /title/);
  assert.match(err({ action: "create", title: "T", body: "x".repeat(60_001), priority: 2 }), /body/);
  assert.match(err({ action: "create", title: "   ", body: "B", priority: 2 }), /title/);
  ok({ action: "create", title: "T", body: "a\tb\r\nc", priority: 2 });
});

test("update: key와 바꿀 칸이 하나 이상, state는 Backlog·Todo만, 알 수 없는 칸 없음", () => {
  assert.deepEqual(ok({ action: "update", key: "atc-5", priority: 3, state: "Todo", labels: ["x"] }), { action: "update", key: "ATC-5", priority: 3, state: "Todo", labels: ["x"] });
  assert.match(err({ action: "update", key: "ATC-5" }), /바꿀 칸/);
  assert.match(err({ action: "update", priority: 2 }), /key/);
  assert.match(err({ action: "update", key: "VOC-5", priority: 2 }), /key/);
  assert.match(err({ action: "update", key: "ATC-5", state: "Done" }), /state/);
  assert.match(err({ action: "update", key: "ATC-5", state: "Started" }), /state/);
  assert.match(err({ action: "update", key: "ATC-5", parent: "ATC-1" }), /알 수 없는 칸/);
  assert.match(err({ action: "update", key: "ATC-5", assigneeId: "x" }), /알 수 없는 칸/);
  assert.match(err({ action: "update", key: "ATC-5", priority: 9 }), /priority/);
});

test("comment: key와 body", () => {
  assert.deepEqual(ok({ action: "comment", key: "ATC-5", body: "hi" }), { action: "comment", key: "ATC-5", body: "hi" });
  assert.match(err({ action: "comment", key: "ATC-5" }), /body/);
  assert.match(err({ action: "comment", body: "x" }), /key/);
  assert.match(err({ action: "comment", key: "ATC-5", body: "x", title: "y" }), /알 수 없는 칸/);
  assert.match(err({ action: "comment", key: "ATC-5", body: "x".repeat(20_001) }), /body/);
});

test("action: create | update | comment만(delete·archive·close·state 등은 없다)", () => {
  for (const a of ["delete", "archive", "close", "state", "move", "assign", "", undefined, 5, null]) assert.match(err({ action: a, key: "ATC-1" }), /action/, String(a));
  for (const raw of [null, undefined, "x", 5, [], [{ action: "create" }]]) assert.match(err(raw), /JSON 객체/);
});

test("이슈 판정: ATC 팀만(다른 팀 이슈는 고치지 않는다)", () => {
  const i = { id: "1", key: "ATC-1", team: "ATC", state: { name: "Todo", type: "unstarted" }, labels: [] };
  assert.deepEqual(issueVerdict(i), { ok: true });
  assert.deepEqual(issueVerdict({ ...i, team: "atc" }), { ok: true });
  for (const team of ["VOC", "", null, "ATCC", "XATC"]) assert.equal(issueVerdict({ ...i, team }).ok, false, String(team));
});

test("상태 이동: 지금 Backlog·Todo 계열이고 가는 곳도 Backlog·Todo일 때만", () => {
  const states = [
    { id: "b", name: "Backlog", type: "backlog" },
    { id: "t", name: "Todo", type: "unstarted" },
    { id: "s", name: "In Progress", type: "started" },
    { id: "d", name: "Done", type: "completed" },
    { id: "c", name: "Canceled", type: "canceled" },
  ];
  assert.deepEqual(stateVerdict({ name: "Backlog", type: "backlog" }, "Todo", states), { ok: true, stateId: "t" });
  assert.deepEqual(stateVerdict({ name: "Todo", type: "unstarted" }, "Backlog", states), { ok: true, stateId: "b" });
  for (const cur of [{ name: "In Progress", type: "started" }, { name: "Done", type: "completed" }, { name: "Canceled", type: "canceled" }]) {
    const r = stateVerdict(cur, "Todo", states);
    assert.equal(r.ok, false, cur.name);
    assert.equal(r.ok === false && r.status, 409);
  }
  for (const to of ["In Progress", "Done", "Canceled", "Nope"]) assert.equal(stateVerdict({ name: "Todo", type: "unstarted" }, to, states).ok, false, to);
});

test("라벨 이름 → id: 대소문자 무시, 없는 이름은 missing(새 라벨을 만들지 않는다)", () => {
  const avail = [{ id: "1", name: "rating:SEC" }, { id: "2", name: "Feature" }];
  assert.deepEqual(resolveLabels(["RATING:sec", "feature", "feature"], avail), { ids: ["1", "2"], missing: [] });
  assert.deepEqual(resolveLabels(["nope", "Feature"], avail), { ids: ["2"], missing: ["nope"] });
  assert.deepEqual(resolveLabels([], avail), { ids: [], missing: [] });
});
