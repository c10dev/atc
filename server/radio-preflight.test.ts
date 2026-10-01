import assert from "node:assert/strict";
import { test } from "node:test";
import type { Op } from "./proposals.ts";
import { radioPhraseOf } from "./radio-phrase.ts";
import { radioOf, type RadioInput } from "./radio.ts";
import { readabilityOf } from "./readability.ts";
import type { LogLine } from "./schedule.ts";

// PREFLIGHT(ATC-267): CROSSCHECK mark와 PREFLIGHT HOLD·HOLD는 호출이 아닌 교신
const T0 = "2026-10-01T10:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();
const empty: RadioInput = { clearances: [], proposals: [], crewChanges: [], reports: [], mcc: [], rts: [] };
const create = { op: "create", id: "D-0254", at: at(0), flight: "ATC-254", airport: "ATCC", registration: "TEAM_J" } as unknown as Op;
const proposals: Op[] = [
  create,
  { op: "crosscheck", id: "D-0254", at: at(1), by: "CROSSCHECK", model: "m", verdict: "disagree", reason: "설계 문서 대기" } as Op,
  { op: "preflight", id: "D-0254", at: at(2), by: "CROSSCHECK", model: "m", codes: ["blocked"], reason: "설계 문서 대기" } as Op,
  { op: "crosscheck", id: "D-0254", at: at(3), by: "CROSSCHECK", model: "m", verdict: "agree", reason: "이제 있음" } as Op,
  { op: "hold", id: "D-0254", at: at(4), blockedBy: ["ATC-253"] } as Op,
];
const schedule: LogLine[] = [
  { op: "draft", id: "S-0005", at: at(5), kind: "CLASSIFY", flight: "ATC-300", payload: {}, reason: "r" } as unknown as LogLine,
  { op: "crosscheck", id: "S-0005", at: at(6), by: "CROSSCHECK", verdict: "agree", reason: "맞음" } as LogLine,
];
const pre = (i: Partial<RadioInput> = {}) => radioOf({ ...empty, proposals, schedule, ...i }).filter((t) => t.freq === "PREFLIGHT");

test("PREFLIGHT: mark 두 개, PREFLIGHT HOLD, HOLD, SCHEDULE mark가 모두 줄이 된다", () => {
  const t = pre();
  assert.deepEqual(t.map((x) => x.kind), ["CROSSCHECK", "PREFLIGHT HOLD", "CROSSCHECK", "HOLD", "CROSSCHECK"]);
  assert.equal(t[0].head, "CROSSCHECK → OCC · D-0254 ATC-254 · DISAGREE");
  assert.equal(t[0].body, "설계 문서 대기");
  assert.deepEqual([t[0].result, t[0].flight, t[0].airport, t[0].aircraft], ["disagree", "ATC-254", "ATCC", "TEAM_J"]);
  assert.equal(t[2].head, "CROSSCHECK → OCC · D-0254 ATC-254 · AGREE"); // 새 mark가 자기 줄의 head를 정한다
  assert.deepEqual([t[1].from, t[1].body], ["CROSSCHECK", "설계 문서 대기"]);
  assert.deepEqual([t[3].from, t[3].to, t[3].body], ["OCC", "ALL", "blocked by ATC-253"]);
  assert.equal(t[4].head, "CROSSCHECK → OCC · S-0005 ATC-300 · AGREE");
  assert.equal(new Set(t.map((x) => x.id)).size, t.length);
});

test("PREFLIGHT 줄은 호출이 아니다: open·overdueAt·replyTo 없음", () => {
  for (const t of pre()) assert.deepEqual([t.open, t.overdueAt, t.replyTo], [undefined, undefined, undefined]);
});

test("READABILITY 숫자가 PREFLIGHT 줄 때문에 달라지지 않는다", () => {
  const w = { from: at(-60), to: at(60) };
  const send = { op: "send", id: "D-0254", at: at(0.5), message: "m" } as Op;
  const accept = { op: "accept", id: "D-0254", at: at(0.7) } as Op;
  const base = radioOf({ ...empty, proposals: [create, send, accept] });
  const withPre = radioOf({ ...empty, proposals: [create, send, accept, ...proposals.slice(1)], schedule });
  assert.ok(withPre.length > base.length);
  assert.deepEqual(readabilityOf(withPre, [], [], w), readabilityOf(base, [], [], w));
});

test("음성: 필드로만 말하고 사유 글은 읽지 않는다", () => {
  const [mark, hold, , oc] = pre();
  assert.equal(radioPhraseOf(mark), "Crosscheck, disagree, ATC two five four.");
  assert.equal(radioPhraseOf(hold), "Crosscheck, preflight hold, ATC two five four.");
  assert.equal(radioPhraseOf(oc), "Delivery, hold, ATC two five four.");
  for (const t of pre()) assert.ok(!/설계|blocked|ATC-253/.test(radioPhraseOf(t) ?? ""));
});
